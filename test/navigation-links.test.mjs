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
