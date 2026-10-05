# 클라우드 설정

## 준비할 정보

- Git 프로젝트의 절대 경로
- Discord 채널 ID
- 허용 사용자 범위: `all` 또는 사용자 ID 목록
- 런타임의 `DISCORD_BOT_TOKEN` 환경변수
- 필요하면 상태 경로와 기존 봇 전용 Codex 홈

Message Content Intent를 켜고 봇에 대상 채널의 View Channel/Send Messages 권한을 줍니다. 기존 봇을 전환할 때는 소유한 기존 서비스를 종료한 뒤 새 서비스를 실행해 중복 응답을 방지합니다. 서로 다른 프로젝트는 다른 채널과 상태 폴더를 사용합니다.

## 실행 환경

Linux/Unix, Python 3.10 이상과 pip, Node 24.5 이상(`--use-env-proxy` 지원), npm, Git, Codex CLI가 필요합니다. CLI는 `plugins`, `shell_tool`, `unified_exec`, `code_mode_host`, `multi_agent`, `remote_plugin` 기능 플래그를 지원해야 합니다.

관리형 제한 네트워크에서 다음 호스트가 필요합니다. 의존성이 이미 준비된 환경도 재설치와 인증 복구를 고려합니다.

설정 명령을 실행하는 Codex의 파일 샌드박스가 프로젝트만 쓰도록 제한하면 별도 상태 폴더의 쓰기 권한도 준비해야 합니다. 설치 스킬은 실행 도구의 지원되는 권한 절차로 필요한 경로만 요청합니다.

- `github.com`: 남욱 프로세스 소스
- `chatgpt.com`, `auth.openai.com`: Codex 실행·디바이스 로그인
- `discord.com`, `gateway.discord.gg`: Discord REST·Gateway
- `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`: 런타임 의존성

설치 스크립트는 알려진 관리형 정책 스냅샷을 읽어 누락된 호스트를 보고합니다. 네트워크 정책을 직접 편집하지 않습니다. 제공되는 클라우드 상태 도구로 현재 정책·변수 준비도도 확인합니다. 상위 프록시·CA·플랫폼 인증 변수는 유지하며 TLS 검증을 끄지 않습니다.

## 관리 스크립트

`manage.py`는 어디에 설치됐든 현재 플러그인 경로를 기준으로 자산을 찾습니다. 프로젝트 경로와 상태 경로는 명시적으로 바인딩합니다. `.codex` 디렉터리가 없어도 Git 프로젝트면 사용할 수 있습니다.

| 명령 | 동작 |
|---|---|
| `setup` | 마켓플레이스 전체 플러그인 설치·최신화, 설정·Node 패키지·Supervisor 준비 |
| `setup --start` | 준비 후 인증이 구성된 경우 실행·실제 점검 |
| `login` | 해당 봇 전용 홈의 디바이스 로그인 |
| `doctor` | 설정·환경변수 존재·설치·로그인 구성 상태 확인 |
| `doctor --probe` | 실제 Codex 실행과 스킬 읽기 추가 확인 |
| `start` | 실제 점검 후 실행·Gateway READY 확인, 같은 설정이면 재사용 |
| `restart` | 해당 데몬을 종료하고 현재 환경으로 다시 실행 |
| `stop` | 해당 서비스와 Supervisor 종료, 데이터 보존 |
| `status`, `logs` | 해당 프로필의 상태·민감값 없는 운영 로그 확인 |
| `update` | 마켓플레이스 전체 플러그인 설치·최신화, 현재 설치본의 새 런타임 준비 |

모든 명령에 동일한 `--project`를 전달합니다. 사용자 지정 상태 경로를 썼으면 모든 명령에 동일한 `--state`도 전달합니다. `--channel`, `--allowed-users`, `--codex-home`, `--timeout-ms`는 `setup` 또는 `update`에서 설정합니다. 생략한 항목은 기존 설정을 유지합니다. 작업 시간 제한은 기본 30분, 최대 1시간입니다.

환경변수의 토큰 값은 데몬 시작 당시 전달됩니다. 값을 바꿨으면 `restart`로 적용합니다. 명령을 반복해서 실행한다고 로그인 저장소를 초기화하거나 같은 프로필의 데몬을 두 개 만들지 않습니다.

## Codex 실행 정책

봇은 프로젝트를 작업 디렉터리로 실행하며 `workspace-write`, `approval_policy=never`를 사용합니다. 추가 승인이 필요한 샌드박스 밖 작업은 실패합니다. 패키지·테스트의 네트워크는 상위 런타임 정책 안에서 허용합니다. 플러그인·셸·도구 호스트·서브에이전트를 켜고 앱·원격 플러그인·브라우저·컴퓨터 제어·이미지 생성은 끕니다. Discord 토큰과 Discord 설정 변수는 하위 CLI에서 제거합니다.

남욱 프로세스의 개발 스킬을 읽어 설계·구현·검증하며 사용자가 요청한 경우에만 Git push·PR 제출·배포 등 외부 반영을 수행하도록 지시합니다. 해당 외부 작업의 추가 계정 인증과 네트워크 허용은 이 설치가 자동으로 보장하지 않습니다.

`config.json`은 이 플러그인의 관리 스크립트가 읽는 설정입니다. Codex 자체의 표준 플러그인 설정 스키마가 아닙니다. 예시는 [config.example.json](../config.example.json)을 참고하세요.
