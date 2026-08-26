import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

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
