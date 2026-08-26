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

test("상단 바와 OVERVIEW 영역은 대시보드 본문 공간을 넓히도록 압축된다", async () => {
  const css = await readFile(new URL("public/styles.css", root), "utf8");
  assert.match(css, /\.topbar \{[^}]*height:\s*54px/);
  assert.match(css, /\.page-content\.dashboard-page \{[^}]*calc\(100dvh - 205px\)[^}]*padding-top:\s*14px/);
  assert.match(css, /\.dashboard-page \.page-heading \{[^}]*align-items:\s*center[^}]*margin-bottom:\s*12px/);
  assert.match(css, /\.dashboard-page \.page-heading \.eyebrow \{[^}]*font-size:\s*8px/);
  assert.match(css, /\.dashboard-page \.page-heading h1 \{[^}]*font-size:\s*23px/);
  assert.match(css, /\.dashboard-page \.live-status \{[^}]*padding:\s*6px 9px/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.dashboard-page \.page-heading \{ gap: 8px; \}/);
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

test("마우스가 순환 패널 위에 머무는 동안 30초 자동 전환과 진행 표시가 정지한다", async () => {
  const [css, app] = await Promise.all([
    readFile(new URL("public/styles.css", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8")
  ]);
  assert.match(app, /let carouselPaused = false/);
  assert.match(app, /if \(carouselPaused \|\| currentPage !== "dashboard"\) return/);
  assert.match(app, /panel\.addEventListener\("mouseenter", \(\) => setCarouselPaused\(true\)\)/);
  assert.match(app, /panel\.addEventListener\("mouseleave", \(\) => setCarouselPaused\(false\)\)/);
  assert.match(app, /if \(paused\) \{\s*clearInterval\(carouselTimer\);\s*carouselTimer = null/);
  assert.match(app, /else startCarousel\(\)/);
  assert.match(css, /\.main-carousel-panel\.carousel-paused \.carousel-progress i \{ animation-play-state: paused; \}/);
});

test("Allo·Global 시각화는 확인된 원본 지도 이미지의 지도 영역을 반응형으로 크롭한다", async () => {
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
  assert.match(css, /\.allo-source-crop \{[^}]*1\.6355/);
  assert.match(css, /\.global-source-crop \{[^}]*1\.99/);
  assert.match(css, /\.allo-source-crop img \{[^}]*top:\s*-36\.57%[^}]*width:\s*126\.58%/);
  assert.match(css, /\.global-source-crop img \{[^}]*left:\s*-2\.41%[^}]*top:\s*-45\.7%[^}]*width:\s*145\.15%/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.source-map-crop \{ width: 100%; height: 100%; \}/);
});

test("국내지도 지역과 세계지도 국가를 클릭하면 선택 상태와 상세 정보가 갱신된다", async () => {
  const [css, app] = await Promise.all([
    readFile(new URL("public/styles.css", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8")
  ]);
  assert.match(app, /const alloRegionDetails = \[/);
  assert.match(app, /const globalCountryDetails = \[/);
  assert.match(app, /data-allo-region="\$\{region\.id\}"/);
  assert.match(app, /data-global-country="\$\{country\.id\}"/);
  assert.match(app, /button\.addEventListener\("click", \(\) => selectAlloRegion\(button\.dataset\.alloRegion\)\)/);
  assert.match(app, /button\.addEventListener\("click", \(\) => selectGlobalCountry\(button\.dataset\.globalCountry\)\)/);
  assert.match(app, /target\.innerHTML = alloMapDetailMarkup\(region\)/);
  assert.match(app, /target\.innerHTML = globalMapDetailMarkup\(country\)/);
  assert.match(app, /확보 타깃/);
  assert.match(app, /미결·후속조치/);
  assert.match(css, /\.map-hotspot[^}]*position:\s*absolute/);
  assert.match(css, /\.map-hotspot:hover::after, \.map-hotspot:focus-visible::after/);
  assert.match(css, /\.map-detail-selector button:hover, \.map-detail-selector button\.active/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.source-map-body \{ grid-template-columns: 1fr; overflow: visible; \}/);
});
