# MedPark One

MedPark 사내 통합 포털을 제공하는 Python 3.11 / Flask 애플리케이션입니다.

## 구성

- 포털 계정·권한·메뉴·감사 로그: PostgreSQL
- MedPark One 중앙 인증: OpenID Connect Authorization Code + PKCE
- 캘린더·기타 외부 API 연동
- 미수채권은 기존 space5 사이트로 연결
- 운영 실행: `Procfile`의 Gunicorn 명령

## 통합 로그인

- Issuer: `https://medprk-medpark-one.mycafe24.ai/sso`
- Discovery: `/sso/.well-known/openid-configuration`
- 서명: RS256, 공개키: `/sso/jwks.json`
- 하위 사이트 권한은 각 사이트가 유지하며, `iss + sub`를 기존 계정에 관리자 확인 후 연결합니다.
- 아마란스는 통합 로그인 대상에서 제외합니다.

## 보안

- 소스와 로그인 화면에 초기 계정, 비밀번호, SSO 서명키 또는 클라이언트 인증키를 저장하지 않습니다.
- `INITIAL_ADMIN_PASSWORD`는 빈 DB의 최초 기동에만 사용하고 초기화 후 제거합니다.
- DB 접속정보는 AI SPACE가 주입하는 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD`만 사용합니다.
- SSO 보안키는 AI SPACE 운영 환경변수에만 등록합니다.

## 운영 확인

- 포털 상태: `/api/health`
- SSO 상태: `/sso/health`
- 배포 전 전체 백업, 배포 후 앱·PostgreSQL·테이블 무결성 검증이 필요합니다.
