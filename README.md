# MedPark One

MedPark 사내 통합 포털을 제공하는 Python 3.11 / Flask 애플리케이션입니다.

## 구성

- 포털 계정·권한·메뉴·감사 로그: PostgreSQL
- 캘린더·기타 외부 API 연동은 추후 적용
- 미수채권은 기존 space5 사이트로 연결
- 운영 실행: `Procfile`의 Gunicorn 명령

## 보안

- 소스와 로그인 화면에 초기 계정 또는 비밀번호를 저장하지 않습니다.
- `INITIAL_ADMIN_PASSWORD`는 빈 DB의 최초 기동에만 사용하고 초기화 후 제거합니다.
- DB 접속정보는 AI SPACE가 주입하는 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD`만 사용합니다.

## 운영 확인

- 포털 상태: `/api/health`
- 배포 전 전체 백업, 배포 후 앱·PostgreSQL·테이블 무결성 검증이 필요합니다.
