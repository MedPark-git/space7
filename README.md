# MedPark One

MedPark 사내 통합 포털과 미수채권 관리 시스템을 한 서비스로 제공하는
Python 3.11 / Flask 애플리케이션입니다.

## 구성

- 포털 및 Google Calendar 연동: PostgreSQL `public` 스키마
- `COLLABORATION → TF → 미수채권 관리`: PostgreSQL `ar` 스키마
- 미수채권 내부 경로: `/tf/ar/`
- 운영 실행: `Procfile`의 Gunicorn 명령

## 보안

- 소스와 로그인 화면에 초기 계정 또는 비밀번호를 저장하지 않습니다.
- `INITIAL_ADMIN_PASSWORD`와 `AR_INITIAL_ADMIN_PASSWORD`는 빈 DB의 최초 기동에만 사용합니다.
- `AR_MIGRATION_TOKEN`이 없으면 일회성 이관 API는 HTTP 404로 비활성화됩니다.
- DB 접속정보는 AI SPACE가 주입하는 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD`만 사용합니다.

## 운영 확인

- 포털 상태: `/api/health`
- 미수채권 상태: `/tf/ar/health`
- 배포 전 전체 백업, 배포 후 앱·PostgreSQL·테이블 무결성 검증이 필요합니다.
