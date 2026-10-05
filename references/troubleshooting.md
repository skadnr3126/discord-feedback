# 문제 해결

먼저 같은 프로젝트·상태 경로로 `doctor`, `status`, `logs`를 실행합니다. 원시 stderr·토큰·인증 파일·전체 환경변수를 채팅이나 로그에 출력하지 않습니다.

| 상태 | 대응 |
|---|---|
| `botTokenConfigured: false` | 런타임에 `DISCORD_BOT_TOKEN`을 설정하고 `restart` |
| 채널 ID 또는 사용자 범위 누락 | `setup --channel ... --allowed-users ...` |
| `codexLoginConfigured: false` | 해당 프로필의 `login` 실행 후 사용자 디바이스 인증 |
| 실행 중 Codex 인증 오류 또는 401 | Discord 답장의 링크에서 일회용 코드 입력, 완료 안내 후 원래 요청 다시 전송 |
| 디바이스 재인증 실패 또는 시간 초과 | ChatGPT 보안 설정·워크스페이스 권한에서 디바이스 코드 로그인 허용 후 요청 재전송. 계속 실패하면 해당 프로필의 `login` 실행 |
| `workflowInstalled: false` | `setup` 재실행, 설치 식별자·의존 원격·커밋 확인 |
| 의존 소스에 미커밋 변경 | 변경을 보존하고 사용자가 정리하거나 새 상태 경로 선택 |
| `code-mode host is disabled` | CLI 기능 지원과 런타임 버전 확인, `update` 후 `restart` |
| `networkPolicy: false` | 지원되는 클라우드 설정에서 보고된 호스트 허용 |
| 서비스 RUNNING, Gateway READY 없음 | 토큰·Message Content Intent·REST/Gateway 정책 확인 |
| 같은 채널의 다른 서비스 발견 | 소유 프로젝트를 확인하고 전환하려는 서비스만 종료 |
| Unix 소켓 경로가 너무 김 | 짧은 `--state` 경로 선택 |
| 작업 시간 초과 | 제한 시간 조정, 부분 변경을 확인한 뒤 다음 피드백으로 이어가기 |

현재 프로젝트에서 의존성 파일이 없거나 CLI가 미지원이면 필요한 도구 설치를 먼저 해결합니다. 환경 상태만으로 외부 API의 권한이 보장된다고 판단하지 않습니다. 실제 점검에서 실패한 항목과 사용자 행동이 필요한 항목을 구분합니다.

임시 클라우드 머신이 교체되면 상태 폴더의 보존 여부를 확인하고 새 환경에서 설정 스킬을 다시 실행합니다. 상시 호스트나 시작 명령 등록 없이 24시간 가동을 약속하지 않습니다.
