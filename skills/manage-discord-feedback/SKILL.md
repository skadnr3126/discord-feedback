---
name: manage-discord-feedback
description: 설정된 Discord 원격 피드백 봇의 상태와 실행 오류를 확인하고 시작·중지·재시작·업데이트를 수행한다. 사용자가 봇 상태, 로그인 문제, 연결 오류, 봇실행, 프로젝트 설정 변경이나 서비스 관리를 요청할 때 사용한다.
---

# Discord 원격 피드백 봇 관리

현재 프로젝트와 저장된 설정을 확인하고 이 파일 기준 `../../scripts/manage.py`를 사용한다. 새 프로젝트의 최초 설정은 [환경 설정](../setup-discord-feedback/SKILL.md)을 따른다. 다른 프로젝트 서비스를 임의로 제어하지 않는다.

```bash
python3 "<plugin-root>/scripts/manage.py" status --project "<project-path>"
python3 "<plugin-root>/scripts/manage.py" doctor --project "<project-path>" --probe
python3 "<plugin-root>/scripts/manage.py" logs --project "<project-path>"
python3 "<plugin-root>/scripts/manage.py" restart --project "<project-path>"
python3 "<plugin-root>/scripts/manage.py" stop --project "<project-path>"
```

상태·진단·운영 로그부터 읽고 문제를 구분한다. 원시 CLI stderr, 인증 파일, 토큰, 프로세스 환경 전체를 출력하지 않는다. 로그인 문제는 해당 프로필의 `login` 명령으로 해결하며 현재 Codex 앱의 주입 인증을 바꾸지 않는다.

설정을 바꾸면 `setup`에 변경할 인수를 지정한 후 `restart`로 새 환경을 적용한다. 토큰 환경변수를 바꾼 경우에도 `restart`를 사용한다. `stop`은 해당 Supervisor 데몬까지 종료하며 인증·설정·세션을 보존한다.

## 업데이트

업데이트 요청이면 등록된 `namuk-marketplace`의 모든 플러그인을 조회하고 아직 설치하지 않은 플러그인을 설치한다. 마켓플레이스는 이미 등록되어 있으므로 다시 등록하지 않는다. 기존 설치는 재사용하며 이 단계에서 재설치하거나 삭제하지 않는다.

봇이 사용할 플러그인은 저장된 `config.json`의 `codexHome`에서 확인·설치한다. 아래 명령을 실행하는 프로세스의 `CODEX_HOME`을 해당 경로로 지정하고, 작업 후 기존 실행 환경을 복원한다. 현재 셸을 확인해 PowerShell 또는 Bash 예시를 선택한다. 운영체제만으로 셸을 추정하지 않는다.

PowerShell에서는 다음 명령을 사용한다. 설치 여부는 JSON의 `installed` 목록과 대조한다.

```powershell
$catalogJson = codex plugin list -m namuk-marketplace --available --json
if ($LASTEXITCODE -ne 0) { throw '마켓플레이스 목록 조회 실패' }
$catalog = $catalogJson | ConvertFrom-Json -ErrorAction Stop
$installedNames = @($catalog.installed | ForEach-Object { $_.name })
$catalog.available | Where-Object { $_.name -notin $installedNames } | ForEach-Object {
    codex plugin add $_.name -m namuk-marketplace
    if ($LASTEXITCODE -ne 0) { throw "플러그인 설치 실패: $($_.name)" }
}
```

Bash에서는 `jq`가 준비되어 있으면 다음 명령을 사용한다. 없으면 사용 가능한 JSON 파서로 같은 목록 비교를 수행한다.

```bash
(
  set -o pipefail
  codex plugin list -m namuk-marketplace --available --json |
    jq -r '([.installed[].name]) as $installed | .available[] | .name as $name | select(($installed | index($name)) == null) | .name' |
    while IFS= read -r plugin; do
      codex plugin add "$plugin" -m namuk-marketplace || exit "$?"
    done
)
```

목록 조회·JSON 해석·설치가 실패하면 완료로 보고하지 않는다. 목록이 비어 있으면 마켓플레이스가 해당 Codex 홈에서 보이는지 확인한다. 설치 후 같은 홈에서 목록을 다시 조회해 마켓플레이스의 모든 플러그인이 설치됐는지 확인하고, 비활성화된 플러그인은 사용자에게 활성화를 안내한다.

플러그인의 새 버전을 설치한 뒤 현재 설치본의 `scripts/manage.py update --project "<project-path>"`로 새 런타임을 준비하고 `restart`한다. 남욱 프로세스는 기존 설치를 재사용하고 없는 경우에만 `codex plugin add namuk-process@namuk-marketplace`로 설치한다. 상태 폴더·인증을 삭제하지 않는다.

`start`/`restart`의 Gateway READY, `doctor --probe`의 실제 스킬 읽기 결과, 필요하면 사용자 메시지 수신·답장을 대조한다. 실패하면 준비된 상태를 보존하고 [문제 해결](../../references/troubleshooting.md)을 따른다. 계정 인증처럼 사용자 행동이 필요한 부분은 이유와 정확한 절차를 알린다.
