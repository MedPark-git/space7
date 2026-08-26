import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 39000 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
let server;
let cookie;

const request = async (path, options = {}) => fetch(`${origin}${path}`, {
  ...options,
  headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(options.headers || {}) }
});

test.before(async () => {
  server = spawn(process.execPath, ["--import", "./test/mock-google.mjs", "server.mjs"], {
    cwd: new URL("..", import.meta.url), env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("테스트 서버 시작 시간 초과")), 5000);
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("MedPark One:")) { clearTimeout(timer); resolve(); }
    });
    server.on("exit", (code) => reject(new Error(`테스트 서버 종료: ${code}`)));
  });
  const login = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "Preview123!" }) });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
});

test.after(() => server?.kill("SIGTERM"));

test("OAuth 캘린더 목록을 불러오고 여러 캘린더를 저장한다", async () => {
  const saved = await request("/api/admin/calendar/settings", { method: "PUT", body: JSON.stringify({ mode: "oauth", calendar_id: "medpark.remote@gmail.com", oauth_client_id: "client.apps.googleusercontent.com", oauth_client_secret: "secret" }) });
  assert.equal(saved.status, 200);

  const start = await request("/api/admin/calendar/oauth/start", { method: "POST" });
  assert.equal(start.status, 200);
  const authorization = new URL((await start.json()).authorization_url);
  const callback = await request(`/api/calendar/oauth/callback?code=test-code&state=${encodeURIComponent(authorization.searchParams.get("state"))}`, { redirect: "manual" });
  assert.equal(callback.status, 302);

  const listed = await request("/api/admin/calendar/calendars");
  assert.equal(listed.status, 200);
  const calendars = (await listed.json()).calendars;
  assert.equal(calendars.length, 2);
  assert.equal(calendars[0].primary_calendar, true);

  const selection = await request("/api/admin/calendar/calendars", { method: "PUT", body: JSON.stringify({ calendar_ids: calendars.map((item) => item.calendar_id) }) });
  assert.equal(selection.status, 200);
  assert.equal((await selection.json()).selected_calendars.length, 2);
});

test("선택한 모든 캘린더의 일정을 병합하고 출처를 보존한다", async () => {
  const response = await request("/api/calendar/events?month=2026-08");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.calendar_count, 2);
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events.map((event) => event.calendar_name), ["메드파크 기본 일정", "전사 주요 일정"]);
  assert.equal(new Set(result.events.map((event) => event.id)).size, 2);
  assert.deepEqual(result.warnings, []);

  const settings = await request("/api/admin/calendar/settings");
  assert.equal(settings.status, 200);
  assert.equal((await settings.json()).selected_calendars.length, 2);
});

test("관리자 인증과 캘린더 선택 입력 무결성을 보호한다", async () => {
  const unauthorized = await fetch(`${origin}/api/admin/calendar/calendars`);
  assert.equal(unauthorized.status, 401);
  const empty = await request("/api/admin/calendar/calendars", { method: "PUT", body: JSON.stringify({ calendar_ids: [] }) });
  assert.equal(empty.status, 400);
});
