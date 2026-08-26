# MedPark One — 사내 통합 포털 1차 미리보기

요구사항 검토를 위한 조작 가능한 프론트엔드 프로토타입입니다. 실제 임직원 데이터나 외부 시스템 인증정보는 포함하지 않습니다.

## 실행

Node.js 20 이상에서 다음 명령을 실행합니다.

```bash
npm start
```

브라우저에서 `http://localhost:3000`을 엽니다.

미리보기 계정:

- 계정 ID: `admin`
- 비밀번호: `Preview123!`

최초 관리자 계정은 PostgreSQL에 자동 생성되며, 운영 전 비밀번호를 반드시 변경해야 합니다.

## 포함 범위

- 비로그인 랜딩 및 대시보드 마스킹
- 일반 계정 ID 기반 로그인과 안전한 서버 세션
- 반응형 좌측 메뉴와 모바일 메뉴
- 캘린더/국내 진행 지도 30초 자동 전환
- 메뉴 검색과 외부 시스템 링크 자리 표시
- 관리자 전용 임직원 계정 등록·비활성화·비밀번호 초기화
- PostgreSQL 사용자·세션·감사 로그 저장
- Plaud/Zapier Webhook 자리 표시 엔드포인트
- PostgreSQL 스키마 초안

## 다음 개발 단계

1. 메뉴·권한 CRUD API 연결
2. 각 외부 시스템 실제 URL 등록
3. Google Calendar OAuth 및 동기화 작업
4. 지도 원본 API 수집·캐싱
5. Plaud/Zapier Webhook 검증·저장
6. 초기 관리자 비밀번호 변경 정책 적용

## AI SPACE 배포 메모

- 대상 공간: `SPACE_07`
- 저장소: `MedPark-git/space7`
- 런타임: Node.js 20
- 데이터베이스: PostgreSQL
- Dockerfile은 사용하지 않습니다.
- DB 환경변수는 AI SPACE가 자동 주입하므로 저장소에 접속정보를 넣지 않습니다.
- 영속 파일이 필요하면 `/app/user_data/`만 사용합니다.
