#!/usr/bin/env python3
"""Prepare a project-specific Discord feedback service outside the plugin cache."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

PLUGIN = Path(__file__).resolve().parent.parent
DEPENDENCY = json.loads((PLUGIN / "dependencies.json").read_text())["workflow"]
ID = re.compile(r"^[0-9]{17,20}$")
REQUIRED_HOSTS = ["github.com", "chatgpt.com", "auth.openai.com", "discord.com",
                  "gateway.discord.gg", "registry.npmjs.org", "pypi.org", "files.pythonhosted.org"]


class SetupError(Exception):
    pass


def run(argv, *, env=None, cwd=None, check=True, capture=True, timeout=120):
    result = subprocess.run([str(x) for x in argv], env=env, cwd=cwd, text=True,
                            capture_output=capture, timeout=timeout)
    if check and result.returncode:
        # Raw authentication errors and process environments never enter reports.
        raise SetupError(f"{Path(str(argv[0])).name} 실행 실패: 종료 코드 {result.returncode}")
    return result


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def state_root():
    configured = os.environ.get("DISCORD_FEEDBACK_STATE_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    if Path("/workspace").is_dir():
        return Path("/workspace/.discord-feedback")
    return Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state"))) / "discord-feedback"


def profile_path(project, explicit=None):
    if explicit:
        return Path(explicit).expanduser().resolve()
    key = hashlib.sha256(str(project).encode()).hexdigest()[:12]
    return state_root() / key


def users(value):
    if value == "all":
        return "all"
    ids = [x.strip() for x in (value or "").split(",") if x.strip()]
    if not ids or not all(ID.fullmatch(x) for x in ids):
        raise SetupError("--allowed-users에 all 또는 쉼표로 구분한 Discord 사용자 ID를 지정하세요.")
    return list(dict.fromkeys(ids))


def network_report():
    policy = Path("/etc/codex/network-policy.json")
    if not policy.is_file():
        return {"mode": "not-managed", "missingHosts": []}
    data = json.loads(policy.read_text())
    if data.get("version") != 1:
        return {"mode": "unknown", "missingHosts": [], "unverified": True}
    http = data.get("http_network_policy", {})
    mode = http.get("type", "unknown")
    if mode not in ["restricted", "unrestricted"]:
        return {"mode": mode, "missingHosts": [], "unverified": True}
    allowed = {x.get("host") for x in http.get("egress_rules", [])}
    missing = [host for host in REQUIRED_HOSTS if host not in allowed] if mode == "restricted" else []
    return {"mode": mode, "missingHosts": missing}


def prerequisites():
    if sys.version_info < (3, 10):
        raise SetupError("Python 3.10 이상이 필요합니다.")
    if os.name != "posix":
        raise SetupError("첫 버전은 Linux/Unix 클라우드만 지원합니다.")
    missing = [name for name in ["node", "npm", "git", "codex"] if not shutil.which(name)]
    if missing:
        raise SetupError("필요한 실행 파일: " + ", ".join(missing))
    run(["node", "--use-env-proxy", "-e", ""])
    supported = {line.split()[0] for line in run(["codex", "features", "list"]).stdout.splitlines() if line.strip()}
    required = {"plugins", "shell_tool", "unified_exec", "code_mode_host", "multi_agent", "remote_plugin"}
    if not required <= supported:
        raise SetupError("현재 Codex CLI가 필요한 기능을 지원하지 않습니다: " + ", ".join(sorted(required - supported)))
    network = network_report()
    if network["missingHosts"] or network.get("unverified"):
        raise SetupError("클라우드의 지원되는 네트워크 설정 절차로 다음 호스트를 허용하세요: " +
                         ", ".join(network["missingHosts"] or ["정책 버전 확인 필요"]))


def environment(config):
    env = dict(os.environ)
    env.update({
        "DISCORD_WORKSPACE_DIR": config["projectDir"],
        "DISCORD_SERVICE_STATE_DIR": config["stateDir"],
        "DISCORD_CODEX_HOME": config["codexHome"],
        "CODEX_HOME": config["codexHome"],
        "CODEX_SQLITE_HOME": str(Path(config["stateDir"]) / "codex-state"),
        "DISCORD_CHANNEL_ID": config["channelId"],
        "DISCORD_ALLOWED_USER_IDS": config["allowedUsers"] if config["allowedUsers"] == "all" else ",".join(config["allowedUsers"]),
        "DISCORD_CODEX_TIMEOUT_MS": str(config["timeoutMs"]),
        "DISCORD_WORKFLOW_PLUGIN": config.get("workflowPlugin", "namuk-process@namuk-marketplace"),
    })
    # Keep inherited proxy, CA and platform authentication variables intact.
    return env


def plugin_list(env):
    result = run(["codex", "plugin", "list", "--disable", "remote_plugin", "--json"], env=env, check=False)
    if result.returncode:
        return []
    try:
        return json.loads(result.stdout).get("installed", [])
    except ValueError:
        return []


def install_workflow(config):
    env = environment(config)
    marketplace = "namuk-marketplace"
    result = run(["codex", "plugin", "list", "-m", marketplace, "--available", "--json"], env=env)
    try:
        catalog = json.loads(result.stdout)
        names = list(dict.fromkeys(entry["name"] for entry in
                                  catalog["installed"] + catalog["available"]))
    except (ValueError, KeyError, TypeError) as error:
        raise SetupError("마켓플레이스 플러그인 목록을 해석할 수 없습니다.") from error
    if DEPENDENCY["name"] not in names:
        raise SetupError("namuk-marketplace에서 namuk-process를 찾을 수 없습니다. 봇 Codex 홈의 등록을 확인하세요.")
    for name in names:
        run(["codex", "plugin", "add", name, "-m", marketplace, "--json"], env=env, capture=False)
    return DEPENDENCY["name"] + "@" + marketplace


def runtime_digest():
    digest = hashlib.sha256()
    for path in sorted((PLUGIN / "runtime").rglob("*")):
        if path.is_file() and not any(x in path.parts for x in ["node_modules", "__pycache__", ".service"]):
            digest.update(str(path.relative_to(PLUGIN / "runtime")).encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


def prepare_runtime(config):
    state = Path(config["stateDir"])
    destination = state / "runtimes" / runtime_digest()
    if not (destination / ".installed").is_file():
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        stage = Path(tempfile.mkdtemp(prefix="prepare-", dir=destination.parent))
        try:
            shutil.copytree(PLUGIN / "runtime", stage, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns("node_modules", ".service", ".env", "__pycache__", "*.pyc"))
            run(["npm", "ci", "--ignore-scripts"], cwd=stage, capture=False, timeout=300)
            (stage / ".installed").write_text(runtime_digest())
            if destination.exists():
                raise SetupError("실행 버전 폴더가 불완전합니다. 기존 폴더를 확인한 뒤 다른 상태 경로에서 설정하세요.")
            stage.rename(destination)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    config["runtimeDir"] = str(destination)
    if not (state / "python/supervisor").is_dir():
        native(config, "install", capture=False)
    return str(destination)


def native(config, action, *, capture=True, check=True):
    return run([sys.executable, Path(config["runtimeDir"]) / "service/manage.py", action],
               env=environment(config), capture=capture, check=check, timeout=300)


def running(config):
    if not config.get("runtimeDir") or not (Path(config["stateDir"]) / "python/supervisor").is_dir():
        return False
    result = native(config, "status", check=False)
    return result.returncode == 0 and "RUNNING" in result.stdout


def fingerprint(config):
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


def doctor(config, probe=False):
    env = environment(config)
    checks = {
        "projectExists": Path(config["projectDir"]).is_dir(),
        "botTokenConfigured": bool(env.get("DISCORD_BOT_TOKEN", "").strip()),
        "runtimeInstalled": bool(config.get("runtimeDir")) and (Path(config.get("runtimeDir", "/nonexistent")) / "node_modules").is_dir(),
        "supervisorInstalled": (Path(config["stateDir"]) / "python/supervisor").is_dir(),
        "workflowInstalled": any(x.get("pluginId") == config.get("workflowPlugin") and x.get("enabled") for x in plugin_list(env)),
        "codexLoginConfigured": run(["codex", "login", "status"], env=env, check=False).returncode == 0,
    }
    network = network_report()
    checks["networkPolicy"] = not network["missingHosts"] and not network.get("unverified")
    report = {"ready": all(checks.values()), "checks": checks, "network": network,
              "projectDir": config["projectDir"], "stateDir": config["stateDir"], "running": running(config)}
    if probe and report["ready"]:
        script = '''const {askCodex}=await import(process.argv[1]);
try {const reply=await askCodex('읽기 전용 설치 점검이다. 설치된 namuk-process의 development-workflow SKILL.md를 읽고 읽기에 성공한 경우 다른 문장 없이 DISCORD_FEEDBACK_READY라고만 답하세요. 파일 수정이나 외부 전송은 하지 마세요.',{},undefined,{readOnly:true,timeoutMs:60000});console.log(JSON.stringify({ok:reply.replaceAll('`','').trim()==='DISCORD_FEEDBACK_READY'}));}
catch(e){console.log(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;}'''
        result = run(["node", "--input-type=module", "-e", script, (Path(config["runtimeDir"]) / "chatbot.mjs").as_uri()],
                     env=env, cwd=config["projectDir"], check=False, timeout=80)
        try:
            report["probe"] = json.loads(result.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            report["probe"] = {"ok": False, "error": "실제 Codex 실행을 확인하지 못했습니다."}
        report["ready"] = report["ready"] and result.returncode == 0 and report["probe"].get("ok", False)
    elif probe:
        report["probe"] = {"ok": False, "error": "기본 설정 또는 로그인이 준비되지 않았습니다."}
    return report


def start(config):
    marker = Path(config["stateDir"]) / "running-config.json"
    if running(config):
        old = json.loads(marker.read_text()) if marker.exists() else {}
        if old.get("fingerprint") == fingerprint(config):
            return {"running": True, "reused": True, "stateDir": config["stateDir"]}
        native(config, "shutdown", check=False)
    # Detect another managed project using the same channel on this host.
    for path in state_root().glob("*/config.json"):
        if path.resolve() == (Path(config["stateDir"]) / "config.json").resolve():
            continue
        other = json.loads(path.read_text())
        if other.get("channelId") == config["channelId"] and running(other):
            raise SetupError("같은 Discord 채널을 사용하는 다른 프로젝트 서비스가 실행 중입니다.")
    report = doctor(config, probe=True)
    if not report["ready"]:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        raise SetupError("실행 준비가 끝나지 않았습니다. doctor 결과를 해결하고 필요하면 login을 실행하세요.")
    log = Path(config["stateDir"]) / "logs/bot.log"
    offset = log.stat().st_size if log.exists() else 0
    native(config, "start", capture=False)
    for _ in range(30):
        if log.exists():
            with log.open() as stream:
                stream.seek(offset)
                if "Discord Gateway READY: bot online" in stream.read():
                    save_json(marker, {"fingerprint": fingerprint(config)})
                    return {"running": True, "gatewayReady": True, "stateDir": config["stateDir"]}
        time.sleep(1)
    raise SetupError("서비스 시작은 요청했지만 Discord READY를 확인하지 못했습니다. logs를 확인하세요.")


def setup(args, project, state):
    prerequisites()
    if not project.is_dir() or run(["git", "-C", project, "rev-parse", "--is-inside-work-tree"], check=False).stdout.strip() != "true":
        raise SetupError("--project에 기존 Git 프로젝트 디렉터리를 지정하세요.")
    if state == PLUGIN or PLUGIN in state.parents:
        raise SetupError("상태 폴더는 플러그인 설치본 밖에 두세요.")
    if len(str(state / "supervisor.sock").encode()) >= 100:
        raise SetupError("Unix 소켓 경로가 너무 깁니다. 더 짧은 --state 경로를 지정하세요.")
    path = state / "config.json"
    previous = json.loads(path.read_text()) if path.exists() else {}
    channel = args.channel or previous.get("channelId") or os.environ.get("DISCORD_CHANNEL_ID", "")
    if not ID.fullmatch(channel):
        raise SetupError("--channel 또는 DISCORD_CHANNEL_ID에 Discord 채널 ID를 지정하세요.")
    allowed = args.allowed_users
    if allowed is None:
        allowed = previous.get("allowedUsers") or os.environ.get("DISCORD_ALLOWED_USER_IDS")
        if isinstance(allowed, list):
            allowed = ",".join(allowed)
    allowed = users(allowed)
    timeout = args.timeout_ms if args.timeout_ms is not None else previous.get("timeoutMs", 1800000)
    if not isinstance(timeout, int) or not 0 < timeout <= 3600000:
        raise SetupError("--timeout-ms는 1~3600000 범위여야 합니다.")
    config = {"schemaVersion": 1, "projectDir": str(project), "stateDir": str(state),
              "channelId": channel, "allowedUsers": allowed, "timeoutMs": timeout,
              "codexHome": str(Path(args.codex_home or previous.get("codexHome") or state / "codex-home").expanduser().resolve()),
              "workflowRepository": DEPENDENCY["repository"]}
    home = Path(config["codexHome"])
    if home == PLUGIN or PLUGIN in home.parents:
        raise SetupError("Codex 인증 경로는 플러그인 설치본 밖에 두세요.")
    Path(config["codexHome"]).mkdir(parents=True, exist_ok=True, mode=0o700)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    config["workflowPlugin"] = install_workflow(config)
    prepare_runtime(config)
    save_json(path, config)
    report = doctor(config)
    report["configured"] = True
    if args.start and report["ready"]:
        report.update(start(config))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ready"] else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["setup", "doctor", "login", "start", "status", "restart", "stop", "logs", "update"])
    parser.add_argument("--project", default=os.getcwd())
    parser.add_argument("--state")
    parser.add_argument("--channel")
    parser.add_argument("--allowed-users")
    parser.add_argument("--codex-home")
    parser.add_argument("--timeout-ms", type=int)
    parser.add_argument("--start", action="store_true")
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    project = Path(args.project).expanduser().resolve()
    state = profile_path(project, args.state)
    try:
        if args.action in ["setup", "update"]:
            return setup(args, project, state)
        path = state / "config.json"
        if not path.is_file():
            raise SetupError("이 프로젝트는 아직 설정되지 않았습니다. 먼저 setup을 실행하세요.")
        config = json.loads(path.read_text())
        if config["projectDir"] != str(project):
            raise SetupError("저장된 설정과 --project 경로가 다릅니다.")
        if args.action == "doctor":
            report = doctor(config, args.probe)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0 if report["ready"] else 2
        if args.action == "login":
            return run(["codex", "login", "--device-auth"], env=environment(config), capture=False, check=False, timeout=1000).returncode
        if args.action == "start":
            print(json.dumps(start(config), ensure_ascii=False, indent=2))
        elif args.action == "restart":
            if running(config):
                native(config, "shutdown", check=False)
            print(json.dumps(start(config), ensure_ascii=False, indent=2))
        elif args.action == "stop":
            native(config, "shutdown", check=False, capture=False)
        else:
            return native(config, args.action, capture=False, check=False).returncode
        return 0
    except (SetupError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        # These errors concern paths and operational state, never stored credentials.
        print(f"설정 실패: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
