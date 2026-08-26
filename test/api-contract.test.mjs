import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);

test("임직원 권한 선택과 목록 표시는 기본(임직원)·관리자로 통일된다", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("public/index.html", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8")
  ]);
  assert.match(html, /<option value="basic">기본\(임직원\)<\/option><option value="admin">관리자<\/option>/);
  assert.doesNotMatch(html, /\[REDACTED\]/);
  assert.match(app, /user\.role === "admin" \? "관리자" : "기본\(임직원\)"/);
});

test("화면에서 사용하는 내부 API와 Google Calendar 연동 경로가 배포 소스에 모두 존재한다", async () => {
  const [app, server] = await Promise.all([
    readFile(new URL("public/app.js", root), "utf8"),
    readFile(new URL("server.mjs", root), "utf8")
  ]);
  const routes = [
    "/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/menu", "/api/quick-links",
    "/api/admin/menu", "/api/admin/menu/order", "/api/admin/users",
    "/api/calendar/events", "/api/admin/calendar/settings", "/api/admin/calendar/calendars",
    "/api/admin/calendar/test", "/api/admin/calendar/oauth/start", "/api/calendar/oauth/callback"
  ];
  routes.forEach((route) => {
    assert.ok(app.includes(route) || route === "/api/calendar/oauth/callback", `프런트엔드 API 누락: ${route}`);
    assert.ok(server.includes(route), `서버 API 누락: ${route}`);
  });
  assert.match(server, /GOOGLE_CALENDAR_REDIRECT_URI/);
  assert.match(server, /oauth2\.googleapis\.com\/token/);
  assert.match(server, /calendar\/v3\/users\/me\/calendarList/);
  assert.match(server, /calendar\/v3\/calendars\/\$\{encodeURIComponent\(calendar\.calendar_id\)\}\/events/);
  assert.match(server, /CALENDAR_SETTINGS_SECRET \|\| process\.env\.DB_PASSWORD/);
});

test("원본 지도 이미지가 브라우저용 PNG 형식으로 제공된다", async () => {
  const server = await readFile(new URL("server.mjs", root), "utf8");
  assert.match(server, /"\.png": "image\/png"/);
});
