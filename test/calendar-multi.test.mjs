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
  assert.deepEqual(result.events.map((event) => event.calendar_color), ["#0a9b7e", "#f6bf26"]);
  assert.deepEqual(result.events.map((event) => event.calendar_foreground), ["#ffffff", "#1d1d1d"]);
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

test("최상위 이름과 모든 카테고리 순서를 저장하고 다시 조회한다", async () => {
  const labels = await request("/api/admin/menu", { method: "PATCH", body: JSON.stringify({ labels: {
    group_workspace: "WORKSPACE", group_business: "BUSINESS", group_collaboration: "COLLABORATION",
    management: "경영사업본부", marketing: "마케팅 사업본부", technology: "기술사업본부",
    amarans: "아마란스", meetings: "회의록", calendar: "일정(캘린더)"
  } }) });
  assert.equal(labels.status, 200);

  const scopes = {
    root: ["collaboration", "business", "workspace"],
    workspace: ["dashboard"],
    business: ["technology", "marketing", "management"],
    collaboration: ["calendar", "meetings", "amarans"],
    management: ["management_routine", "management_hr", "management_ar"],
    marketing: ["marketing_global", "marketing_aesthetic", "marketing_medical", "marketing_dental", "marketing_allo"],
    technology: ["technology_focus"]
  };
  const ordered = await request("/api/admin/menu/order", { method: "PUT", body: JSON.stringify({ scopes }) });
  assert.equal(ordered.status, 200);
  const orderedResult = await ordered.json();
  assert.equal(orderedResult.labels.group_collaboration, "COLLABORATION");
  assert.equal(orderedResult.order.collaboration.item_order, 0);
  assert.equal(orderedResult.order.calendar.parent_id, "collaboration");
  assert.equal(orderedResult.order.calendar.item_order, 0);

  const menu = await request("/api/menu");
  assert.equal(menu.status, 200);
  const menuResult = await menu.json();
  assert.equal(menuResult.labels.management, "경영사업본부");
  assert.equal(menuResult.order.workspace.item_order, 2);

  const unauthorized = await fetch(`${origin}/api/admin/menu/order`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scopes }) });
  assert.equal(unauthorized.status, 401);
  const invalid = await request("/api/admin/menu/order", { method: "PUT", body: JSON.stringify({ scopes: { ...scopes, root: ["workspace", "business"] } }) });
  assert.equal(invalid.status, 400);
});

test("새 카테고리는 지정한 최상단 바로 아래 또는 그 하위에 등록된다", async () => {
  const topResponse = await request("/api/admin/menu", { method: "POST", body: JSON.stringify({
    group_id: "workspace", parent_id: "", label: "업무 자료", icon: "▣", url: ""
  }) });
  assert.equal(topResponse.status, 201);
  const topResult = await topResponse.json();
  assert.equal(topResult.item.parent_id, "workspace");

  const childResponse = await request("/api/admin/menu", { method: "POST", body: JSON.stringify({
    group_id: "workspace", parent_id: topResult.item.id, label: "공통 서식", url: "https://example.com/forms"
  }) });
  assert.equal(childResponse.status, 201);
  const childResult = await childResponse.json();
  assert.equal(childResult.item.parent_id, topResult.item.id);

  const menu = await request("/api/menu");
  const menuResult = await menu.json();
  assert.ok(menuResult.customItems.some((item) => item.id === topResult.item.id && item.parent_id === "workspace"));
  assert.ok(menuResult.customItems.some((item) => item.id === childResult.item.id && item.parent_id === topResult.item.id));

  const mismatched = await request("/api/admin/menu", { method: "POST", body: JSON.stringify({
    group_id: "collaboration", parent_id: "management", label: "잘못된 위치"
  }) });
  assert.equal(mismatched.status, 400);
  const adminGroup = await request("/api/admin/menu", { method: "POST", body: JSON.stringify({ group_id: "admin", label: "관리 기능" }) });
  assert.equal(adminGroup.status, 400);
});
