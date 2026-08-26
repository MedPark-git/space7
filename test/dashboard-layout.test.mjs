import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);

test("대시보드 보조 영역은 데스크톱에서 기존 폭의 절반 이하로 유동 조절된다", async () => {
  const css = await readFile(new URL("public/styles.css", root), "utf8");
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*clamp\(88px,\s*8vw,\s*120px\)/);
  assert.match(css, /grid-template-columns:\s*clamp\(210px,\s*16vw,\s*270px\)\s*minmax\(0,1fr\)/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.dashboard-top-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.dashboard-side-vertical \{ grid-template-columns: 1fr; \}/);
});

test("캘린더 일정은 Google 캘린더 고유 배경색과 글자색을 사용한다", async () => {
  const [css, app] = await Promise.all([
    readFile(new URL("public/styles.css", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8")
  ]);
  assert.match(css, /background:\s*var\(--event-color/);
  assert.match(css, /color:\s*var\(--event-foreground/);
  assert.match(app, /event\.calendar_color/);
  assert.match(app, /event\.calendar_foreground/);
});

test("캘린더 7개 요일 열은 좁은 화면에서도 잘리지 않고 상세 목록만 아래로 이동한다", async () => {
  const css = await readFile(new URL("public/styles.css", root), "utf8");
  assert.match(css, /grid-template-columns:\s*repeat\(7,\s*minmax\(0,1fr\)\)/);
  assert.match(css, /\.calendar-grid\s*>\s*:is\(div,button\)\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /container:\s*dashboard-main\s*\/\s*inline-size/);
  assert.match(css, /@container dashboard-main \(max-width: 700px\)[\s\S]*?\.main-calendar-view \{ grid-template-columns: minmax\(0,1fr\); \}/);
  assert.match(css, /@container dashboard-main \(max-width: 700px\)[\s\S]*?\.dashboard-page \.schedule-list \{[^}]*border-top/);
});

test("캘린더 날짜 선택 시 해당일의 전체 일정 상세가 오른쪽에서 갱신된다", async () => {
  const [css, app] = await Promise.all([
    readFile(new URL("public/styles.css", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8")
  ]);
  assert.match(app, /data-calendar-date=/);
  assert.match(app, /drawSelectedDate\(button\.dataset\.calendarDate\)/);
  assert.match(app, /focusEvents\.map\(\(event\)/);
  assert.doesNotMatch(app, /focusEvents\.slice\(0,5\)/);
  assert.match(app, /event\.description/);
  assert.match(css, /\.calendar-grid \.selected-day/);
  assert.match(css, /\.schedule-item p/);
});

test("대시보드와 일정 메뉴에 처음 들어가면 금일 일정 상세를 유지한다", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(app, /const resetCalendarToToday = \(\) =>/);
  assert.match(app, /selectedCalendarDateKey = calendarKey\(today\)/);
  assert.match(app, /const renderDashboard = \(\) => \{\s*resetCalendarToToday\(\)/);
  assert.match(app, /const renderCalendarPage = \(\) => \{\s*resetCalendarToToday\(\)/);
  assert.match(app, /todayScheduleCount/);
});

test("30초 순환 패널은 인증 확인된 Allo·Global 지도 구조와 원본 링크를 제공한다", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(app, /const carouselModes = \["calendar", "allo", "global"\]/);
  assert.match(app, /setInterval\([\s\S]*?30000\)/);
  assert.match(app, /전국 지역별 커버리지/);
  assert.match(app, /국가별 거래처 FCST ERP 확정매출/);
  assert.match(app, /https:\/\/medprk-medpark-allo\.mycafe24\.ai\//);
  assert.match(app, /https:\/\/medprk-medpark-global-maps\.mycafe24\.ai\//);
  assert.match(app, /관리자 로그인 후 확인한 원본 지도 화면/);
  assert.doesNotMatch(app, /source-password|source-username|관리자 비밀번호/);
});

test("Allo·Global 시각화는 확인된 원본 지도 이미지와 정확한 반응형 크롭을 사용한다", async () => {
  const [css, app, alloImage, globalImage] = await Promise.all([
    readFile(new URL("public/styles.css", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8"),
    readFile(new URL("public/assets/medpark-allo-coverage.png", root)),
    readFile(new URL("public/assets/global-market-action-map.png", root))
  ]);
  assert.deepEqual([alloImage.readUInt32BE(16), alloImage.readUInt32BE(20)], [1619, 1476]);
  assert.deepEqual([globalImage.readUInt32BE(16), globalImage.readUInt32BE(20)], [2048, 1198]);
  assert.match(app, /assets\/medpark-allo-coverage\.png/);
  assert.match(app, /assets\/global-market-action-map\.png/);
  assert.doesNotMatch(app, /const koreaMap|const worldMap|coverageMarkers|globalMarketPoints/);
  assert.match(css, /\.allo-source-crop \{[^}]*2\.0703/);
  assert.match(css, /\.global-source-crop \{[^}]*2\.65/);
  assert.match(css, /\.source-map-crop img \{[^}]*width:\s*100%[^}]*height:\s*auto/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.source-map-crop \{ width: 100%; height: 100%; \}/);
});
