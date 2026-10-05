"""Install and control the Discord bot's Unix background service."""
import argparse
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
STATE = Path(os.environ.get("DISCORD_SERVICE_STATE_DIR", str(ROOT / ".service"))).resolve()
CONFIG = STATE / "supervisord.conf"
PACKAGE_DIR = STATE / "python"


def supervisor(module, *args, check=True, capture=False):
    script = (
        "import sys;sys.path.insert(0,sys.argv.pop(1));"
        f"from supervisor.{module} import main;main()"
    )
    return subprocess.run(
        [sys.executable, "-c", script, str(PACKAGE_DIR), "-c", str(CONFIG), *args],
        check=check, capture_output=capture, text=True,
    )


def configure():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    logs = STATE / "logs"
    logs.mkdir(exist_ok=True, mode=0o700)
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required")
    # Supervisor performs %-interpolation, even on filesystem paths.
    def escaped(value):
        return str(value).replace("%", "%%")
    command = " ".join(shlex.quote(str(p)) for p in [node, ROOT / "service/runtime.mjs"])
    CONFIG.write_text(f"""[unix_http_server]
file={escaped(STATE / 'supervisor.sock')}
chmod=0700

[supervisord]
nodaemon=false
logfile={escaped(logs / 'supervisor.log')}
logfile_maxbytes=5MB
logfile_backups=3
loglevel=info
pidfile={escaped(STATE / 'supervisord.pid')}
childlogdir={escaped(logs)}
umask=0077

[rpcinterface:supervisor]
supervisor.rpcinterface_factory=supervisor.rpcinterface:make_main_rpcinterface

[supervisorctl]
serverurl=unix://{escaped(STATE / 'supervisor.sock')}

[program:discord-bot]
command={escaped(command)}
directory={escaped(ROOT)}
autostart=true
autorestart=true
startsecs=0
startretries=10
stopsignal=TERM
stopwaitsecs=10
stopasgroup=true
killasgroup=true
redirect_stderr=true
stdout_logfile={escaped(logs / 'bot.log')}
stdout_logfile_maxbytes=5MB
stdout_logfile_backups=3
""")
    CONFIG.chmod(0o600)


def install():
    if os.name != "posix":
        raise RuntimeError("The background service requires a Unix host")
    # Fail early when Node lacks the flag required by both REST and Gateway.
    subprocess.run(["node", "--use-env-proxy", "-e", ""], check=True)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    subprocess.run([
        sys.executable, "-m", "pip", "install", "--upgrade", "--target", str(PACKAGE_DIR),
        "--cache-dir", str(STATE / "pip-cache"), "-r", str(ROOT / "service/requirements.txt"),
    ], check=True)
    configure()
    print(f"Service installed. State/log directory: {STATE}")


def start():
    if not (PACKAGE_DIR / "supervisor").is_dir():
        raise RuntimeError("Run npm run service:install first")
    missing = [name for name in ["DISCORD_BOT_TOKEN", "DISCORD_CHANNEL_ID"]
               if not os.environ.get(name, "").strip()]
    if missing and not (ROOT / ".env").is_file():
        raise RuntimeError("Missing runtime variables: " + ", ".join(missing))
    os.environ.setdefault("CODEX_SQLITE_HOME", str(STATE / "codex-state"))
    configure()
    alive = supervisor("supervisorctl", "pid", check=False, capture=True)
    if alive.returncode == 0:
        status = supervisor("supervisorctl", "status", "discord-bot", check=False, capture=True)
        if "RUNNING" not in status.stdout:
            supervisor("supervisorctl", "start", "discord-bot")
    else:
        supervisor("supervisord")
    supervisor("supervisorctl", "status", "discord-bot")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "start", "status", "restart", "stop", "shutdown", "logs"])
    args = parser.parse_args()
    try:
        if args.action == "install":
            install()
        elif args.action == "start":
            start()
        elif args.action == "logs":
            # The runtime logs event labels, not token values or message contents.
            path = STATE / "logs/bot.log"
            print("\n".join(path.read_text().splitlines()[-30:]))
        elif args.action in ["restart", "stop"]:
            supervisor("supervisorctl", args.action, "discord-bot")
        else:
            supervisor("supervisorctl", args.action)
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print(f"Service command failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
