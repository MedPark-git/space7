# MedPark One — 사내 통합 포털 1차 미리보기

요구사항 검토를 위한 조작 가능한 프론트엔드 프로토타입입니다. 실제 임직원 데이터나 외부 시스템 인증정보는 포함하지 않습니다.

## 실행

Node.js 20 이상에서 다음 명령을 실행합니다.

```bash
npm start
```

브라우저에서 `http://localhost:3000`을 엽니다.

미리보기 계정:

- 이메일: `admin@medpark.co.kr`
- 비밀번호: `Preview123!`

위 계정은 UI 검토 전용이며 운영 배포 전 반드시 PostgreSQL 기반 인증과 비밀번호 해시 방식으로 교체해야 합니다.

## 포함 범위

- 비로그인 랜딩 및 대시보드 마스킹
- 5:5 로그인 화면과 정상 로그인·로그아웃 흐름
- 반응형 좌측 메뉴와 모바일 메뉴
- 캘린더/국내 진행 지도 30초 자동 전환
- 메뉴 검색과 외부 시스템 링크 자리 표시
- 관리자 임직원 목록·검색 UI
- Plaud/Zapier Webhook 자리 표시 엔드포인트
- PostgreSQL 스키마 초안

## 다음 개발 단계

1. PostgreSQL 연결 및 세션 기반 인증 구현
2. 메뉴·임직원·권한 CRUD API 연결
3. 각 외부 시스템 실제 URL 등록
4. Google Calendar OAuth 및 동기화 작업
5. 지도 원본 API 수집·캐싱
6. Plaud/Zapier Webhook 검증·저장
7. 감사 로그와 운영 보안 정책 적용

## AI SPACE 배포 메모

- 대상 공간: `SPACE_07`
- 저장소: `MedPark-git/space7`
- 런타임: Node.js 20
- 데이터베이스: PostgreSQL
- Dockerfile은 사용하지 않습니다.
- DB 환경변수는 AI SPACE가 자동 주입하므로 저장소에 접속정보를 넣지 않습니다.
- 영속 파일이 필요하면 `/app/user_data/`만 사용합니다.
