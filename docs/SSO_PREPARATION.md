# MedPark AI SPACE SSO 사전 설정

기준일: 2026-09-16. 아마란스는 제외한다.

## 이번 준비본의 완료 범위

- AI SPACE 내 공간 20개 전부 사전 등록: 사용 중 11개, 빈 공간 9개.
- MedPark One `포털 관리 → SSO 설정`에 관리자 전용 현황과 JSON 다운로드 추가.
- 각 공간에 독립된 client ID 예약. 실제 사이트가 있는 공간만 정확한 HTTPS callback / logout 주소 준비.
- 신규 사이트는 빈 공간의 기존 client ID를 사용하고, 실제 배치된 URL을 검증하여 등록한다.
- 설정 검사기와 사이트별/전체 설정 내보내기 제공.
- 기존 계정, 세션, 비밀번호, 역할, 작성 이력 및 업무 DB를 수정하지 않는다.

**이번 코드는 실제 SSO 인증 서버 또는 각 사이트의 SSO 로그인 구현이 아니다.**
인증 서버, 로그인 콜백, 인증키 발급, 계정 연결, 세션 폐기 기능은 후속 연동에서 구현해야 한다.
현재 설정은 `mode=preparation`, `authentication_enabled=false`, 모든 사이트 `enabled=false`이다.
준비 화면에 활성화 버튼이 없으며, 설정 파일에서 플래그를 켜도 검증 오류로 거부한다.
`planned_issuer`와 callback 주소는 계획된 주소이며, 동작하는 인증 endpoint를 의미하지 않는다.
공개 discovery 문서나 token endpoint도 제공하지 않는다.

## 공간 현황

| 공간 | 사이트 | 인증 구조 확인 | 후속 작업 |
|---|---|---|---|
| space_01 | MedPark Allo | 내부 배포 소스 확인 필요 | 실제 소스·계정·권한 점검 |
| space_02 | 빈 공간 | 생성 대기 | 실제 사이트 배치 후 주소 등록 |
| space_03 | HR MAPS | 내부 배포 소스 확인 필요 | 실제 소스·계정·권한 점검 |
| space_04 | 기술·학회 MAPS | 내부 배포 소스 확인 필요 | 실제 소스·계정·권한 점검 |
| space_05 | 미수채권 | Flask 사용자 세션 | 기존 사용자 ID에 연결 |
| space_06 | 회의록 | 공용 접속 비밀번호 | 임직원별 신원·접근 정책과 접속 이력 추가 |
| space_07 | MedPark One | 포털 임직원 세션 | 기존 임직원 승인·정지 정책과 인증 서버 연계 |
| space_08 | 경영 업무현황 | Flask-Login 사용자 계정 | 기존 사용자 ID·역할에 연결 |
| space_09 | 자금일보 | Flask-Login 사용자 계정 | 비밀번호 변경 요구·권한 정책 유지 |
| space_10 | 재고관리 | Flask-Login 사용자 계정 | 기존 사용자 ID·역할에 연결 |
| space_11 | Global MAPS | Flask 사용자 세션 | 기존 사용자 ID·역할에 연결 |
| space_12 | 브랜드·디자인 | 내부 배포 소스 확인 필요 | 실제 소스·계정·권한 점검 |
| space_13~20 | 빈 공간 | 생성 대기 | 실제 사이트 배치 후 주소 등록 |

공간 목록을 기준으로 현재 실제 배치된 프로젝트만 포함했다. 프로젝트 목록에만 남아 있는
`medprk-medpark-global-maps-s11`은 현재 배치된 공간과 중복되어 등록하지 않았다.
GitHub 연결 사이트의 표기는 저장소 코드 점검 결과이며 Production 코드와의 일치 보증이 아니다.
검토한 `app.py` blob SHA는 `config/sso_spaces.json`에 기록했다.
내부 배포 사이트는 저장소/운영 소스를 확인하기 전까지 `unverified` 상태로 둔다.
공간 이름이나 저장소 이름만으로 연동 또는 배포 대상을 자동 결정하지 않는다.

## 공통 연결 기준

1. 표준 OpenID Connect Authorization Code + PKCE S256를 사용한다.
2. 포털은 사용자 진입점이다. 중앙 인증 서비스는 기존 포털 계정과 연결하고,
   검증된 OIDC 구현을 사용한다. 준비본에는 OIDC 프로토콜을 직접 구현하지 않았다.
3. 로그인한 사람은 `(iss, sub)`로 식별한다. 사용자 이름이나 확인되지 않은 이메일만으로
   기존 계정을 자동 연결하지 않는다. 관리자가 확인한 고유한 연결을 사용한다.
4. 포털 관리자 권한을 다른 사이트 관리자 권한으로 자동 승격하지 않는다.
   각 사이트 기존 권한 및 접근 허용을 서버에서 확인한다. 자동 계정 생성은 기본 금지한다.
5. 사이트별 독립 client ID/비밀키를 사용한다. 비밀키는 실제 연동 시 발급하고,
   소스 저장소·내보내기 JSON·브라우저 저장소에 넣지 않는다.
6. 리디렉션 주소는 등록된 정확한 HTTPS 주소와 일치해야 한다. 와일드카드와 외부 주소를 금지한다.
7. 서로 다른 사이트에 쿠키나 세션 서명 키를 공유하지 않는다. 각 사이트는 검증한 로그인에
   자체 세션을 만들고 state, nonce, PKCE, 서명, issuer, audience, 만료를 검증한다.
8. 계정 정지·퇴사는 새 로그인 차단과 기존 사이트 세션 폐기를 함께 구현한다.
   back-channel logout 및 요청 시 활성 상태 재검증을 구현·검증한다.
   설정의 60초 재검증은 목표값이며 현재 보장되는 기능이 아니다.
9. OIDC 서버·키 관리·각 사이트 연동이 검증된 후에만 사이트별로 전환한다.
   비상 관리자 로그인 정책과 인증 서버 장애 시 동작도 실제 구현 단계에서 검증한다.

표준 참고: https://openid.net/specs/openid-connect-core-1_0.html
로그아웃 참고: https://openid.net/specs/openid-connect-backchannel-1_0.html

## 관리 API

모두 기존 MedPark One 관리자 세션이 필요하며 읽기만 허용한다.

- `GET /api/admin/sso/preparation`: 전체 준비 현황
- `GET /api/admin/sso/preparation/export`: 전체 연결 준비 JSON
- `GET /api/admin/sso/preparation/clients/<client_id>/config`: 개별 사이트 준비 JSON

비로그인 401, 일반 사용자 403, 미등록 client 404, 빈 공간 설정 다운로드 409,
설정 파일 오류 503. 응답에 `Cache-Control: no-store, private`를 적용한다.
POST/PUT/PATCH/DELETE로 활성화할 수 없다.

## 설정 관리와 신규 공간 추가

설정 원본은 `config/sso_spaces.json`이다. AI SPACE 목록을 다시 조회하여 확인한 정보만 반영한다.
이 화면은 운영 API를 주기적으로 조회하지 않으므로, 공간 생성·프로젝트 이동·주소 변경 후에는
설정 원본도 갱신해야 한다. 공개 도메인이 같다는 이유만으로 대상 소유권을 인정하지 않는다.

빈 공간에 사이트를 만들면 해당 항목에 실제 `project_id`, `public_url`, callback 및 logout URI,
확인한 인증 구조를 기록하고 `status=prepared`로 변경한다. `enabled=false`는 유지한다.
새 공간을 추가로 확보한 경우, 새 `space_id`, `space_label`, 중복 없는 `client_id`로 예약 항목을 추가한다.
새 사이트에서도 기존 site-specific 인증 연동 작업은 필요하다.

```sh
python scripts/export_sso_config.py --check
python scripts/export_sso_config.py --client medpark-space-06 --output meeting-sso-preparation.json
python scripts/export_sso_config.py --output medpark-sso-preparation.json
python -m unittest test_sso_preparation test_portal
node scripts/test_sso_ui.mjs
```

실제 client 등록 시 `oidc_client` 객체만 공급자 등록 형식에 맞추어 사용한다.
이 JSON을 적용하는 것만으로 SSO가 활성화되지 않는다.

## 운영 반영 범위와 검증

이번 준비본의 배포 대상은 `medprk-medpark-one` / space_07 / `MedPark-git/space7` 한 곳이다.
다른 사이트는 현재 조회·설정 준비 대상이며 수정하거나 재배포하지 않는다.
DB migration, 기존 로그인 endpoint 변경, 비밀키 발급, 환경변수 변경은 없다.
배포 시 현재 source와 최신 저장소 변경을 재확인하고 기존 배포 절차를 따른다.

검증: 관리자 접근 통제, 전체 20개 등록, 잘못된/중복 URI 거부, 비활성 강제,
기존 로그인·로그아웃 회귀, 새 공간 예약, JSON 내보내기, UI escaping 및 비동기 탭 이동 확인.
로컬 검증은 Flask 3.1.0 / Werkzeug 3.1.3 / Python 3.12의 메모리 저장소에서 수행했다.
Production은 Python 3.11이며, 실제 배포 화면·운영 DB·SSO end-to-end는 이 단계에서 검증하지 않았다.
