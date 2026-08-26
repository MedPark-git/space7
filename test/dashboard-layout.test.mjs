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
  assert.match(css, /\.calendar-grid\s*>\s*div\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /container:\s*dashboard-main\s*\/\s*inline-size/);
  assert.match(css, /@container dashboard-main \(max-width: 700px\)[\s\S]*?\.main-calendar-view \{ grid-template-columns: minmax\(0,1fr\); \}/);
  assert.match(css, /@container dashboard-main \(max-width: 700px\)[\s\S]*?\.dashboard-page \.schedule-list \{[^}]*border-top/);
});
