# Discord 원격 피드백 플러그인

Linux/Unix 클라우드의 Git 프로젝트에 Discord 봇과 남욱 프로세스를 설정합니다. 사용자가 지정 채널에서 봇을 멘션하고 피드백을 보내면 프로젝트별 Codex CLI 세션이 설계·구현·검증하고 결과를 답장합니다.

## 설치

이 저장소는 Codex 마켓플레이스와 플러그인을 함께 포함합니다. 다른 클라우드 프로젝트에서는 GitHub 저장소를 마켓플레이스로 등록해 설치합니다.

```bash
codex plugin marketplace add https://github.com/skadnr3126/discord-feedback.git --ref main
codex plugin add discord-feedback@discord-feedback-marketplace
```

소스를 로컬에 내려받은 경우에는 다음 명령을 사용합니다.

```bash
codex plugin marketplace add /path/to/discord-feedback
codex plugin add discord-feedback@discord-feedback-marketplace
```

## 사용

설치 후 Codex에 다음과 같이 요청합니다.

> setup-discord-feedback 스킬로 이 프로젝트의 Discord 원격 피드백 환경을 설정해줘. 채널은 지정한 DISCORD_CHANNEL_ID를 쓰고 지정 채널 접근자 모두가 요청할 수 있게 해줘.

[환경 설정 스킬](plugins/discord-feedback/skills/setup-discord-feedback/SKILL.md)이 프로젝트·채널·사용자 범위를 확인하고 관리 스크립트를 실행합니다. 남욱 프로세스 설치, 실행 의존성, 봇 전용 인증과 백그라운드 서비스가 준비됩니다. 최초 계정 로그인과 클라우드 네트워크 정책 변경에는 사용자의 플랫폼·계정 작업이 필요할 수 있습니다.

[운영 스킬](plugins/discord-feedback/skills/manage-discord-feedback/SKILL.md)은 상태 확인, 오류 진단, 시작·중지·재시작과 업데이트를 담당합니다.

```bash
python3 plugins/discord-feedback/scripts/manage.py setup --project /workspace/my-project --allowed-users all
python3 plugins/discord-feedback/scripts/manage.py login --project /workspace/my-project
python3 plugins/discord-feedback/scripts/manage.py start --project /workspace/my-project
python3 plugins/discord-feedback/scripts/manage.py doctor --project /workspace/my-project --probe
```

`DISCORD_BOT_TOKEN`과 `DISCORD_CHANNEL_ID`는 런타임 환경변수로 준비합니다. 토큰은 설정 파일이나 명령행 인수에 저장하지 않습니다. 사용자 ID 제한은 `--allowed-users 123456789012345678,234567890123456789`처럼 지정합니다. `all`은 지정 채널 접근자 전체입니다.

요청은 `@봇 이름 버그 수정해줘`처럼 봇을 직접 멘션해 보냅니다. 일반 메시지, 다른 사용자·역할 멘션, 봇 멘션만 있는 메시지는 작업을 시작하지 않습니다. 봇 답장에 응답할 때와 재인증 후 요청을 다시 보낼 때도 봇을 멘션해야 합니다.

## 실행 상태와 의존성

기본 상태 경로는 클라우드에서 `/workspace/.discord-feedback/<프로젝트 경로 해시>`입니다. 그 외 Unix 환경에서는 `$XDG_STATE_HOME/discord-feedback` 또는 `~/.local/state/discord-feedback` 아래를 사용합니다. `--state`나 `DISCORD_FEEDBACK_STATE_ROOT`로 바꿀 수 있습니다. 실행 파일과 Node 의존성은 상태 폴더의 버전별 디렉터리에 배치해 설치 캐시와 분리합니다.

봇 전용 Codex 홈이 프로젝트마다 생성됩니다. 기존의 봇 전용 로그인을 지정하려면 설정 시 `--codex-home`을 사용합니다. 인증 파일을 플러그인에 포함하거나 주입된 플랫폼 인증을 덮어쓰지 않습니다. 대화는 채널별 프로젝트 세션으로 저장하고 한 번에 하나씩 처리합니다.

실행 중 Codex 인증이 만료되면 원래 Discord 메시지에 재인증 링크와 일회용 코드를 답장합니다. 사용자가 링크에서 로그인하고 코드를 입력하면 인증 완료를 알려줍니다. 완료 후 원래 요청을 다시 보내 작업을 이어갑니다. 코드는 15분 동안 유효하며, 실패하거나 시간이 초과되면 요청을 다시 보내 새 인증을 시작할 수 있습니다. 디바이스 코드 로그인은 ChatGPT 보안 설정 또는 워크스페이스 권한에서 허용해야 합니다.

남욱 프로세스는 Discord 피드백 플러그인과 같은 `namuk-marketplace`에서 제공합니다. `setup`과 `update`는 봇이 사용하는 Codex 홈의 기존 설치를 재사용하고, 없는 경우에만 `codex plugin add namuk-process@namuk-marketplace`로 설치합니다. 이미 설치된 남욱 프로세스를 재설치하거나 자동 갱신하지 않습니다. 비활성화 상태면 활성화를 안내합니다.

플러그인의 새 버전 설치 후 `update`와 `restart`를 실행해 런타임을 갱신합니다. `stop`은 해당 서비스만 종료하고 인증·세션·설정을 보존합니다. 다른 머신의 중복 서비스를 자동으로 찾거나 머신 종료 후 24시간 가용성을 보장하지 않습니다.

## 검증

```bash
python3 -m unittest discover -s tests -v
```

런타임 테스트는 준비된 상태 폴더의 `runtimes/<버전 해시>`에서 `npm test`로 실행합니다. `doctor --probe`는 실제 모델과 설치 스킬 읽기를 확인하며 코드를 수정하지 않습니다. 실제 Discord 메시지 수신·답장은 사용자가 채널에 메시지를 보낸 뒤 운영 로그로 확인합니다.

자세한 환경 요구사항과 명령은 [클라우드 설정](plugins/discord-feedback/references/cloud-setup.md), 오류 대응은 [문제 해결](plugins/discord-feedback/references/troubleshooting.md)을 참고하세요.
