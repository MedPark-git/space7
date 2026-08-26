import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

test("최상위 아마란스 메뉴가 공식 그룹웨어 주소로 연결된다", () => {
  assert.match(app, /id:\s*"amarans"[^\n]+url:\s*"https:\/\/gw\.medpark\.kr\/"/);
  assert.match(app, /item\.url\s*&&\s*!hasChildren/);
  assert.match(app, /target="_blank"\s+rel="noopener noreferrer"/);
});

test("메뉴 검색 결과에서도 외부 주소를 안전하게 연다", () => {
  assert.match(app, /item\.url[\s\S]*?class="search-result"[\s\S]*?target="_blank"/);
});

test("WORKSPACE·BUSINESS·COLLABORATION 계층과 기본 하위 카테고리가 일치한다", () => {
  assert.match(app, /id:\s*"workspace",\s*label:\s*"WORKSPACE"[\s\S]*?id:\s*"dashboard"[\s\S]*?title:\s*"통합 대시보드"/);
  assert.match(app, /id:\s*"business",\s*label:\s*"BUSINESS"[\s\S]*?title:\s*"경영사업본부"[\s\S]*?title:\s*"마케팅 사업본부"[\s\S]*?title:\s*"기술사업본부"/);
  assert.match(app, /id:\s*"collaboration",\s*label:\s*"COLLABORATION"[\s\S]*?title:\s*"아마란스"[\s\S]*?title:\s*"회의록"[\s\S]*?title:\s*"일정\(캘린더\)"/);
  assert.doesNotMatch(app, /id:\s*"admin",\s*label:\s*"ADMIN"[\s\S]{0,200}?id:\s*"calendar"/);
});

test("카테고리 등록 시 소속 최상단을 선택하고 ADMIN은 제외한다", () => {
  assert.match(app, /id="menuCreateGroup"\s+name="group_id"/);
  assert.match(app, /configurableMenuGroups\(\)\.map/);
  assert.match(app, /ADMIN은 고정 영역입니다/);
  assert.match(app, /id="menuCreateParent"\s+name="parent_id"/);
});

test("일정 조회는 COLLABORATION에, 연동 관리는 ADMIN에 분리된다", () => {
  assert.match(app, /id:\s*"collaboration"[\s\S]*?id:\s*"calendar"[^\n]+title:\s*"일정\(캘린더\)"/);
  assert.match(app, /id:\s*"admin",\s*label:\s*"ADMIN"[\s\S]*?id:\s*"calendar_admin"[^\n]+title:\s*"일정\(캘린더\)_관리자"/);
  assert.match(app, /\["admin",\s*"calendar_admin"\]\.includes\(page\)/);
  assert.match(app, /page === "calendar_admin"\) renderCalendarSettings\(\)/);
});

test("임직원 일정 화면에는 연결 설정이 노출되지 않고 BUSINESS 중복 일정은 제거된다", () => {
  const start = app.indexOf("const renderCalendarPage");
  const end = app.indexOf("const openSidebar", start);
  const calendarPage = app.slice(start, end);
  assert.doesNotMatch(calendarPage, /연결 설정|openCalendarAdmin/);
  assert.match(server, /20260826_remove_business_calendar_v1/);
  assert.match(server, /parent_id IS NULL OR parent_id='business'/);
  assert.match(server, /menu\.legacy_calendar\.delete/);
});
