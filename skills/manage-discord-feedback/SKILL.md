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

플러그인의 새 버전을 설치한 뒤 `update`로 새 런타임·의존 플러그인 버전을 준비하고 `restart`한다. 업데이트는 `dependencies.json`의 의존 저장소에서 원격 기본 브랜치의 최신 커밋을 받아 설치한다. 미커밋 의존 소스를 자동으로 덮어쓰거나 상태 폴더·인증을 삭제하지 않는다.

`start`/`restart`의 Gateway READY, `doctor --probe`의 실제 스킬 읽기 결과, 필요하면 사용자 메시지 수신·답장을 대조한다. 실패하면 준비된 상태를 보존하고 [문제 해결](../../references/troubleshooting.md)을 따른다. 계정 인증처럼 사용자 행동이 필요한 부분은 이유와 정확한 절차를 알린다.
