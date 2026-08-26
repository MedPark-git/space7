import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const root = fileURLToPath(new URL("./public", import.meta.url));
const port = Number(process.env.PORT || 3000);
const sessionCookie = "medpark_session";
const sessionTtlMs = 12 * 60 * 60 * 1000;
const usernamePattern = /^[A-Za-z0-9._-]{4,30}$/;
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8" };
const staticCacheControl = (extension) => extension === ".html" ? "no-store, max-age=0" : "no-cache, max-age=0, must-revalidate";
const dbConfig = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"].every((key) => process.env[key]);
let pool = null;
const memory = { users: new Map(), sessions: new Map(), audits: [], menuLabels: new Map(), customMenuItems: new Map(), quickLinks: new Map(), calendarSettings: null };
const calendarRedirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || "https://medprk-medpark-one.mycafe24.ai/api/calendar/oauth/callback";
const calendarScope = "https://www.googleapis.com/auth/calendar.readonly";
const editableMenuIds = new Set([
  "management", "management_ar", "management_hr", "management_routine",
  "marketing", "marketing_allo", "marketing_dental", "marketing_medical", "marketing_aesthetic", "marketing_global",
  "technology", "technology_focus", "amarans", "meetings", "calendar"
]);
const builtInTopMenuIds = new Set(["management", "marketing", "technology", "amarans", "meetings", "calendar"]);
const quickLinkCatalog = Object.freeze({
  ar: { id: "ar", label: "미수채권", icon: "₩", url: "https://medprk-ar-dashboard.mycafe24.ai/" },
  hr: { id: "hr", label: "HR", icon: "♙", url: "https://medprk-medpark-hr-maps.mycafe24.ai/" },
  allo: { id: "allo", label: "MedPark-Allo", icon: "◫", url: "https://medprk-medpark-allo.mycafe24.ai/" },
  global: { id: "global", label: "Global-MAPS", icon: "◎", url: "https://medprk-medpark-global-maps.mycafe24.ai/" },
  tech: { id: "tech", label: "기술부 중점 업무", icon: "◇", url: "https://medprk-medpark-tech-conference-maps.mycafe24.ai/" }
});
const defaultQuickLinkIds = ["ar", "hr", "allo", "global"];
const calendarCache = new Map();

const calendarEncryptionKey = () => createHash("sha256").update(String(process.env.CALENDAR_SETTINGS_SECRET || process.env.DB_PASSWORD || "medpark-one-local-calendar-key")).digest();
const encryptSecret = (value) => {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", calendarEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
};
const decryptSecret = (encoded) => {
  if (!encoded) return null;
  try {
    const [iv, tag, encrypted] = String(encoded).split(".").map((part) => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", calendarEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch { return null; }
};

const hashPassword = async (password) => {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString("hex")}`;
};

const verifyPassword = async (password, encoded) => {
  const [algorithm, salt, hash] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const derived = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(hash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
};

const publicUser = (user) => ({
  id: user.id, username: user.username, email: user.email || "", name: user.name,
  employee_no: user.employee_no || "", department: user.department || "",
  role: user.role, status: user.status, created_at: user.created_at
});

const initDatabase = async () => {
  if (!dbConfig) {
    const id = randomUUID();
    memory.users.set(id, { id, username: "admin", email: "", password_hash: await hashPassword("Preview123!"), name: "김관리", employee_no: "M001", department: "경영지원본부", role: "admin", status: "active", created_at: new Date().toISOString() });
    return;
  }
  const { Pool } = await import("pg");
  pool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY, username varchar(30) UNIQUE, email varchar(255), password_hash text NOT NULL,
      name varchar(100) NOT NULL, employee_no varchar(50) UNIQUE, department varchar(150),
      status varchar(20) NOT NULL DEFAULT 'active', role varchar(20) NOT NULL DEFAULT 'basic',
      terminated_at timestamptz, password_changed_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS username varchar(30);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS terminated_at timestamptz;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS department varchar(150);
    ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username)) WHERE username IS NOT NULL;
    CREATE TABLE IF NOT EXISTS portal_sessions (
      token_hash char(64) PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id bigserial PRIMARY KEY, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      action varchar(100) NOT NULL, target_type varchar(100), target_id varchar(255),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, ip_address inet, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS portal_menu_labels (
      menu_id varchar(50) PRIMARY KEY, label varchar(40) NOT NULL,
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS portal_custom_menu_items (
      id uuid PRIMARY KEY, parent_id varchar(50), label varchar(40) NOT NULL,
      icon varchar(8), url text, item_order integer NOT NULL DEFAULT 0,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS user_quick_links (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      system_id varchar(30) NOT NULL, position integer NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, system_id)
    );
    CREATE TABLE IF NOT EXISTS calendar_integration_settings (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1), mode varchar(20) NOT NULL,
      calendar_id varchar(255) NOT NULL, api_key_encrypted text, oauth_client_id text,
      oauth_client_secret_encrypted text, access_token_encrypted text, refresh_token_encrypted text,
      token_expiry timestamptz, oauth_state_hash char(64), oauth_state_expiry timestamptz,
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  const count = Number((await pool.query("SELECT count(*)::int AS count FROM users WHERE status::text = 'active' AND role::text = 'admin'")).rows[0].count);
  if (count === 0) {
    await pool.query(`INSERT INTO users (id,username,email,password_hash,name,employee_no,department,role,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), "admin", null, await hashPassword("Preview123!"), "김관리", "M001", "경영지원본부", "admin", "active"]);
  }
};

const findUserByUsername = async (username) => {
  const value = String(username || "").toLowerCase();
  if (pool) return (await pool.query("SELECT * FROM users WHERE lower(username) = $1 LIMIT 1", [value])).rows[0] || null;
  return [...memory.users.values()].find((user) => user.username.toLowerCase() === value) || null;
};

const listUsers = async () => {
  if (pool) return (await pool.query("SELECT * FROM users ORDER BY created_at DESC")).rows.map(publicUser);
  return [...memory.users.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(publicUser);
};

const writeAudit = async (actorId, action, targetType, targetId, metadata, ip) => {
  if (pool) await pool.query("INSERT INTO audit_logs (actor_user_id,action,target_type,target_id,metadata,ip_address) VALUES ($1,$2,$3,$4,$5,$6)", [actorId,action,targetType,targetId,metadata,ip || null]);
  else memory.audits.push({ actorId, action, targetType, targetId, metadata, ip, createdAt: new Date().toISOString() });
};

const listMenuLabels = async () => {
  if (pool) return Object.fromEntries((await pool.query("SELECT menu_id, label FROM portal_menu_labels")).rows.map((row) => [row.menu_id, row.label]));
  return Object.fromEntries(memory.menuLabels);
};

const listCustomMenuItems = async () => {
  if (pool) return (await pool.query("SELECT id::text, parent_id, label, icon, url, item_order FROM portal_custom_menu_items ORDER BY item_order, created_at")).rows;
  return [...memory.customMenuItems.values()].sort((a, b) => a.item_order - b.item_order);
};

const getMenuConfig = async () => ({ labels: await listMenuLabels(), customItems: await listCustomMenuItems() });

const customMenuExists = async (id, topOnly = false) => {
  if (pool) return Boolean((await pool.query(`SELECT 1 FROM portal_custom_menu_items WHERE id::text=$1 ${topOnly ? "AND parent_id IS NULL" : ""} LIMIT 1`, [id])).rowCount);
  const item = memory.customMenuItems.get(id);
  return Boolean(item && (!topOnly || !item.parent_id));
};

const normalizeMenuUrl = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return null;
  let parsed;
  try { parsed = new URL(value); } catch { throw Object.assign(new Error("연결 URL 형식을 확인해 주세요."), { status: 400 }); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw Object.assign(new Error("연결 URL은 http 또는 https 주소만 사용할 수 있습니다."), { status: 400 });
  return parsed.toString();
};

const updateMenuLabels = async (input, actor, ip) => {
  const labels = input && typeof input.labels === "object" && !Array.isArray(input.labels) ? input.labels : null;
  if (!labels) throw Object.assign(new Error("수정할 카테고리 이름을 입력해 주세요."), { status: 400 });
  const normalized = {};
  for (const [id, raw] of Object.entries(labels)) {
    if (!editableMenuIds.has(id) && !await customMenuExists(id)) throw Object.assign(new Error("수정할 수 없는 카테고리입니다."), { status: 400 });
    const label = String(raw || "").trim();
    if (!label || label.length > 40) throw Object.assign(new Error("카테고리 이름은 1~40자로 입력해 주세요."), { status: 400 });
    normalized[id] = label;
  }
  if (!Object.keys(normalized).length) throw Object.assign(new Error("수정할 카테고리를 선택해 주세요."), { status: 400 });
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [id, label] of Object.entries(normalized)) {
        if (editableMenuIds.has(id)) await client.query("INSERT INTO portal_menu_labels (menu_id,label,updated_by) VALUES ($1,$2,$3) ON CONFLICT (menu_id) DO UPDATE SET label=EXCLUDED.label, updated_by=EXCLUDED.updated_by, updated_at=now()", [id,label,actor.id]);
        else await client.query("UPDATE portal_custom_menu_items SET label=$2, updated_at=now() WHERE id::text=$1", [id,label]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } else {
    Object.entries(normalized).forEach(([id, label]) => {
      if (editableMenuIds.has(id)) memory.menuLabels.set(id, label);
      else memory.customMenuItems.get(id).label = label;
    });
  }
  await writeAudit(actor.id, "menu.labels.update", "portal_menu", "navigation", { labels: normalized }, ip);
  return getMenuConfig();
};

const createMenuItem = async (input, actor, ip) => {
  const label = String(input.label || "").trim();
  const parentId = String(input.parent_id || "").trim() || null;
  const icon = String(input.icon || "").trim().slice(0, 2) || "◇";
  const url = normalizeMenuUrl(input.url);
  if (!label || label.length > 40) throw Object.assign(new Error("카테고리 이름은 1~40자로 입력해 주세요."), { status: 400 });
  if (parentId && !builtInTopMenuIds.has(parentId) && !await customMenuExists(parentId, true)) throw Object.assign(new Error("상위 카테고리를 찾을 수 없습니다."), { status: 400 });
  if (!parentId && url) throw Object.assign(new Error("연결 URL은 하위 카테고리를 등록할 때 설정해 주세요."), { status: 400 });
  const id = randomUUID();
  let itemOrder = 1;
  if (pool) {
    itemOrder = Number((await pool.query("SELECT COALESCE(max(item_order),0)+1 AS next_order FROM portal_custom_menu_items WHERE parent_id IS NOT DISTINCT FROM $1", [parentId])).rows[0].next_order);
    await pool.query("INSERT INTO portal_custom_menu_items (id,parent_id,label,icon,url,item_order,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id,parentId,label,icon,url,itemOrder,actor.id]);
  } else {
    itemOrder = [...memory.customMenuItems.values()].filter((item) => item.parent_id === parentId).reduce((max, item) => Math.max(max, item.item_order), 0) + 1;
    memory.customMenuItems.set(id, { id, parent_id: parentId, label, icon, url, item_order: itemOrder });
  }
  await writeAudit(actor.id, "menu.item.create", "portal_menu", id, { parent_id: parentId, label, url: Boolean(url) }, ip);
  return { item: { id, parent_id: parentId, label, icon, url, item_order: itemOrder }, ...(await getMenuConfig()) };
};

const publicQuickLink = (id) => quickLinkCatalog[id] ? { ...quickLinkCatalog[id] } : null;

const getQuickLinks = async (userId) => {
  let ids;
  if (pool) ids = (await pool.query("SELECT system_id FROM user_quick_links WHERE user_id=$1 ORDER BY position", [userId])).rows.map((row) => row.system_id);
  else ids = memory.quickLinks.get(userId) || [];
  if (!ids.length) ids = defaultQuickLinkIds;
  return { links: ids.map(publicQuickLink).filter(Boolean), catalog: Object.values(quickLinkCatalog) };
};

const updateQuickLinks = async (input, user, ip) => {
  const ids = Array.isArray(input.system_ids) ? [...new Set(input.system_ids.map((id) => String(id)))] : [];
  if (!ids.length || ids.length > 5) throw Object.assign(new Error("자주 찾는 시스템은 1~5개를 선택해 주세요."), { status: 400 });
  if (ids.some((id) => !quickLinkCatalog[id])) throw Object.assign(new Error("선택할 수 없는 시스템이 포함되어 있습니다."), { status: 400 });
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM user_quick_links WHERE user_id=$1", [user.id]);
      for (const [position, id] of ids.entries()) await client.query("INSERT INTO user_quick_links (user_id,system_id,position) VALUES ($1,$2,$3)", [user.id,id,position]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } else memory.quickLinks.set(user.id, ids);
  await writeAudit(user.id, "user.quick_links.update", "user", user.id, { system_ids: ids }, ip);
  return getQuickLinks(user.id);
};

const getCalendarSettingsRow = async () => {
  if (pool) return (await pool.query("SELECT * FROM calendar_integration_settings WHERE id=1")).rows[0] || null;
  return memory.calendarSettings;
};

const publicCalendarSettings = (row) => ({
  configured: Boolean(row), mode: row?.mode || "api_key", calendar_id: row?.calendar_id || "medpark.remote@gmail.com",
  api_key_saved: Boolean(row?.api_key_encrypted), oauth_client_id: row?.oauth_client_id || "",
  oauth_client_secret_saved: Boolean(row?.oauth_client_secret_encrypted),
  connected: row?.mode === "api_key" ? Boolean(row?.api_key_encrypted) : Boolean(row?.refresh_token_encrypted || row?.access_token_encrypted),
  redirect_uri: calendarRedirectUri, scope: calendarScope, updated_at: row?.updated_at || null
});

const saveCalendarSettings = async (input, actor, ip) => {
  const existing = await getCalendarSettingsRow();
  const mode = input.mode === "oauth" ? "oauth" : "api_key";
  const calendarId = String(input.calendar_id || "").trim();
  const apiKey = String(input.api_key || "").trim();
  const clientId = String(input.oauth_client_id || "").trim();
  const clientSecret = String(input.oauth_client_secret || "").trim();
  if (!calendarId || calendarId.length > 255) throw Object.assign(new Error("Google 캘린더 ID를 입력해 주세요."), { status: 400 });
  if (mode === "api_key" && !apiKey && !existing?.api_key_encrypted) throw Object.assign(new Error("Google Calendar API 키를 입력해 주세요."), { status: 400 });
  if (mode === "oauth" && (!clientId || (!clientSecret && !existing?.oauth_client_secret_encrypted))) throw Object.assign(new Error("OAuth 2.0 Client ID와 Client Secret을 모두 입력해 주세요."), { status: 400 });
  const row = {
    id: 1, mode, calendar_id: calendarId,
    api_key_encrypted: apiKey ? encryptSecret(apiKey) : existing?.api_key_encrypted || null,
    oauth_client_id: clientId || existing?.oauth_client_id || null,
    oauth_client_secret_encrypted: clientSecret ? encryptSecret(clientSecret) : existing?.oauth_client_secret_encrypted || null,
    access_token_encrypted: mode === existing?.mode ? existing?.access_token_encrypted || null : null,
    refresh_token_encrypted: mode === existing?.mode ? existing?.refresh_token_encrypted || null : null,
    token_expiry: mode === existing?.mode ? existing?.token_expiry || null : null,
    oauth_state_hash: null, oauth_state_expiry: null, updated_by: actor.id, updated_at: new Date().toISOString()
  };
  if (pool) {
    await pool.query(`INSERT INTO calendar_integration_settings
      (id,mode,calendar_id,api_key_encrypted,oauth_client_id,oauth_client_secret_encrypted,access_token_encrypted,refresh_token_encrypted,token_expiry,oauth_state_hash,oauth_state_expiry,updated_by,updated_at)
      VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()) ON CONFLICT (id) DO UPDATE SET
      mode=EXCLUDED.mode,calendar_id=EXCLUDED.calendar_id,api_key_encrypted=EXCLUDED.api_key_encrypted,
      oauth_client_id=EXCLUDED.oauth_client_id,oauth_client_secret_encrypted=EXCLUDED.oauth_client_secret_encrypted,
      access_token_encrypted=EXCLUDED.access_token_encrypted,refresh_token_encrypted=EXCLUDED.refresh_token_encrypted,
      token_expiry=EXCLUDED.token_expiry,oauth_state_hash=NULL,oauth_state_expiry=NULL,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [row.mode,row.calendar_id,row.api_key_encrypted,row.oauth_client_id,row.oauth_client_secret_encrypted,row.access_token_encrypted,row.refresh_token_encrypted,row.token_expiry,null,null,actor.id]);
  } else memory.calendarSettings = row;
  calendarCache.clear();
  await writeAudit(actor.id, "calendar.settings.update", "calendar_integration", "google", { mode, calendar_id: calendarId }, ip);
  return publicCalendarSettings(await getCalendarSettingsRow());
};

const googleError = async (response, fallback) => {
  let detail = fallback;
  try { detail = (await response.json())?.error?.message || detail; } catch {}
  return Object.assign(new Error(detail), { status: response.status >= 400 && response.status < 500 ? 400 : 502 });
};

const saveOAuthState = async (row, state) => {
  const hash = createHash("sha256").update(state).digest("hex");
  const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  if (pool) await pool.query("UPDATE calendar_integration_settings SET oauth_state_hash=$1,oauth_state_expiry=$2 WHERE id=1", [hash,expiry]);
  else Object.assign(row, { oauth_state_hash: hash, oauth_state_expiry: expiry });
};

const startCalendarOAuth = async (actor, ip) => {
  const row = await getCalendarSettingsRow();
  if (!row || row.mode !== "oauth" || !row.oauth_client_id || !row.oauth_client_secret_encrypted) throw Object.assign(new Error("OAuth 설정을 먼저 저장해 주세요."), { status: 400 });
  const state = randomBytes(32).toString("base64url");
  await saveOAuthState(row, state);
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.search = new URLSearchParams({ client_id: row.oauth_client_id, redirect_uri: calendarRedirectUri, response_type: "code", scope: calendarScope, access_type: "offline", prompt: "consent", state }).toString();
  await writeAudit(actor.id, "calendar.oauth.start", "calendar_integration", "google", {}, ip);
  return { authorization_url: authUrl.toString() };
};

const exchangeCalendarOAuthCode = async (code, state) => {
  const row = await getCalendarSettingsRow();
  const stateHash = createHash("sha256").update(String(state || "")).digest("hex");
  if (!row || !row.oauth_state_hash || row.oauth_state_hash !== stateHash || new Date(row.oauth_state_expiry).getTime() < Date.now()) throw Object.assign(new Error("Google 승인 요청이 만료되었거나 올바르지 않습니다."), { status: 400 });
  const clientSecret = decryptSecret(row.oauth_client_secret_encrypted);
  if (!clientSecret) throw Object.assign(new Error("OAuth Client Secret을 복호화할 수 없습니다."), { status: 500 });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: String(code || ""), client_id: row.oauth_client_id, client_secret: clientSecret, redirect_uri: calendarRedirectUri, grant_type: "authorization_code" }) });
  if (!response.ok) throw await googleError(response, "Google OAuth 승인 처리에 실패했습니다.");
  const token = await response.json();
  const access = encryptSecret(token.access_token);
  const refresh = token.refresh_token ? encryptSecret(token.refresh_token) : row.refresh_token_encrypted;
  const expiry = new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString();
  if (pool) await pool.query("UPDATE calendar_integration_settings SET access_token_encrypted=$1,refresh_token_encrypted=$2,token_expiry=$3,oauth_state_hash=NULL,oauth_state_expiry=NULL,updated_at=now() WHERE id=1", [access,refresh,expiry]);
  else Object.assign(row, { access_token_encrypted: access, refresh_token_encrypted: refresh, token_expiry: expiry, oauth_state_hash: null, oauth_state_expiry: null, updated_at: new Date().toISOString() });
  calendarCache.clear();
};

const calendarAccessToken = async (row) => {
  const current = decryptSecret(row.access_token_encrypted);
  if (current && new Date(row.token_expiry).getTime() > Date.now() + 60_000) return current;
  const refreshToken = decryptSecret(row.refresh_token_encrypted);
  const clientSecret = decryptSecret(row.oauth_client_secret_encrypted);
  if (!refreshToken || !clientSecret) throw Object.assign(new Error("Google 계정 승인이 필요합니다."), { status: 400 });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: row.oauth_client_id, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
  if (!response.ok) throw await googleError(response, "Google 인증 갱신에 실패했습니다.");
  const token = await response.json();
  const expiry = new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString();
  const encrypted = encryptSecret(token.access_token);
  if (pool) await pool.query("UPDATE calendar_integration_settings SET access_token_encrypted=$1,token_expiry=$2,updated_at=now() WHERE id=1", [encrypted,expiry]);
  else Object.assign(row, { access_token_encrypted: encrypted, token_expiry: expiry, updated_at: new Date().toISOString() });
  return token.access_token;
};

const fetchCalendarEvents = async (month) => {
  const row = await getCalendarSettingsRow();
  if (!row) return { connected: false, events: [], message: "관리자가 Google Calendar 연결을 설정해 주세요." };
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : now.getMonth();
  if (monthIndex < 0 || monthIndex > 11 || year < 2000 || year > 2100) throw Object.assign(new Error("조회 월 형식을 확인해 주세요."), { status: 400 });
  const cacheKey = `${row.mode}:${row.calendar_id}:${year}-${monthIndex + 1}`;
  const cached = calendarCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  const params = new URLSearchParams({ timeMin: new Date(Date.UTC(year,monthIndex,1)).toISOString(), timeMax: new Date(Date.UTC(year,monthIndex + 1,1)).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", timeZone: "Asia/Seoul" });
  const headers = { accept: "application/json" };
  if (row.mode === "api_key") params.set("key", decryptSecret(row.api_key_encrypted) || "");
  else headers.authorization = `Bearer ${await calendarAccessToken(row)}`;
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(row.calendar_id)}/events?${params}`, { headers });
  if (!response.ok) throw await googleError(response, row.mode === "api_key" ? "API 키 또는 공개 캘린더 설정을 확인해 주세요." : "Google Calendar 일정을 불러오지 못했습니다.");
  const data = await response.json();
  const value = { connected: true, mode: row.mode, calendar_id: row.calendar_id, events: (data.items || []).filter((event) => event.status !== "cancelled").map((event) => ({ id: event.id, title: event.summary || "제목 없는 일정", start: event.start?.dateTime || event.start?.date, end: event.end?.dateTime || event.end?.date, all_day: Boolean(event.start?.date), location: event.location || "", html_link: event.htmlLink || "" })) };
  calendarCache.set(cacheKey, { expires: Date.now() + 5 * 60 * 1000, value });
  return value;
};

const createUser = async (input, actor, ip) => {
  const username = String(input.username || "").trim().toLowerCase();
  const password = String(input.password || "");
  const name = String(input.name || "").trim();
  const role = input.role === "admin" ? "admin" : "basic";
  if (!usernamePattern.test(username)) throw Object.assign(new Error("계정 ID는 영문자·숫자·._- 조합 4~30자로 입력해 주세요."), { status: 400 });
  if (password.length < 8) throw Object.assign(new Error("초기 비밀번호는 8자 이상이어야 합니다."), { status: 400 });
  if (!name) throw Object.assign(new Error("성명을 입력해 주세요."), { status: 400 });
  if (await findUserByUsername(username)) throw Object.assign(new Error("이미 사용 중인 계정 ID입니다."), { status: 409 });
  const user = { id: randomUUID(), username, email: String(input.email || "").trim() || null, password_hash: await hashPassword(password), name, employee_no: String(input.employee_no || "").trim() || null, department: String(input.department || "").trim() || null, role, status: "active", created_at: new Date().toISOString() };
  if (pool) {
    const created = (await pool.query(`INSERT INTO users (id,username,email,password_hash,name,employee_no,department,role,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [user.id,user.username,user.email,user.password_hash,user.name,user.employee_no,user.department,user.role,user.status])).rows[0];
    await writeAudit(actor.id, "user.create", "user", user.id, { username, role }, ip);
    return publicUser(created);
  }
  memory.users.set(user.id, user);
  await writeAudit(actor.id, "user.create", "user", user.id, { username, role }, ip);
  return publicUser(user);
};

const updateUser = async (id, input, actor, ip) => {
  const existing = pool ? (await pool.query("SELECT * FROM users WHERE id = $1", [id])).rows[0] : memory.users.get(id);
  if (!existing) throw Object.assign(new Error("계정을 찾을 수 없습니다."), { status: 404 });
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const name = has("name") ? String(input.name || "").trim() : existing.name;
  const employeeNo = has("employee_no") ? String(input.employee_no || "").trim() || null : existing.employee_no;
  const department = has("department") ? String(input.department || "").trim() || null : existing.department;
  const email = has("email") ? String(input.email || "").trim() || null : existing.email;
  const status = input.status === "terminated" ? "terminated" : input.status === "active" ? "active" : existing.status;
  const role = input.role === "admin" ? "admin" : input.role === "basic" ? "basic" : existing.role;
  if (!name) throw Object.assign(new Error("성명을 입력해 주세요."), { status: 400 });
  if (actor.id === id && role !== "admin") throw Object.assign(new Error("현재 로그인한 관리자의 권한은 해제할 수 없습니다."), { status: 400 });
  if (input.password && String(input.password).length < 8) throw Object.assign(new Error("비밀번호는 8자 이상이어야 합니다."), { status: 400 });
  const passwordHash = input.password ? await hashPassword(String(input.password)) : existing.password_hash;
  const changes = {};
  if (has("name")) changes.name = name;
  if (has("employee_no")) changes.employee_no = employeeNo;
  if (has("department")) changes.department = department;
  if (has("email")) changes.email = email;
  if (has("role")) changes.role = role;
  if (has("status")) changes.status = status;
  if (input.password) changes.password_reset = true;
  if (pool) {
    const values = [id];
    const assignments = [];
    const assign = (column, value) => { values.push(value); assignments.push(`${column}=$${values.length}`); };
    if (has("name")) assign("name", name);
    if (has("employee_no")) assign("employee_no", employeeNo);
    if (has("department")) assign("department", department);
    if (has("email")) assign("email", email);
    if (has("role")) assign("role", role);
    if (has("status")) {
      assign("status", status);
      assign("terminated_at", status === "terminated" ? new Date() : null);
    }
    if (input.password) {
      assign("password_hash", passwordHash);
      assign("password_changed_at", new Date());
    }
    if (!assignments.length) return publicUser(existing);
    assignments.push("updated_at=now()");
    const row = (await pool.query(`UPDATE users SET ${assignments.join(", ")} WHERE id=$1 RETURNING *`, values)).rows[0];
    if ((has("status") && status === "terminated") || input.password) await pool.query("DELETE FROM portal_sessions WHERE user_id=$1", [id]);
    await writeAudit(actor.id, "user.update", "user", id, changes, ip);
    return publicUser(row);
  }
  if (has("name")) existing.name = name;
  if (has("employee_no")) existing.employee_no = employeeNo;
  if (has("department")) existing.department = department;
  if (has("email")) existing.email = email;
  if (has("role")) existing.role = role;
  if (has("status")) Object.assign(existing, { status, terminated_at: status === "terminated" ? new Date().toISOString() : null });
  if (input.password) existing.password_hash = passwordHash;
  if ((has("status") && status === "terminated") || input.password) for (const [token, session] of memory.sessions) if (session.userId === id) memory.sessions.delete(token);
  await writeAudit(actor.id, "user.update", "user", id, changes, ip);
  return publicUser(existing);
};

const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
const createSession = async (userId) => {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionTtlMs);
  if (pool) await pool.query("INSERT INTO portal_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)", [tokenHash(token),userId,expiresAt]);
  else memory.sessions.set(tokenHash(token), { userId, expiresAt: expiresAt.getTime() });
  return token;
};

const getSessionUser = async (token) => {
  if (!token) return null;
  const hash = tokenHash(token);
  if (pool) return (await pool.query(`SELECT u.* FROM portal_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status::text='active'`, [hash])).rows[0] || null;
  const session = memory.sessions.get(hash);
  if (!session || session.expiresAt <= Date.now()) return null;
  return memory.users.get(session.userId) || null;
};

const deleteSession = async (token) => {
  if (!token) return;
  if (pool) await pool.query("DELETE FROM portal_sessions WHERE token_hash=$1", [tokenHash(token)]);
  else memory.sessions.delete(tokenHash(token));
};

const sendJson = (res, status, payload, headers = {}) => { res.writeHead(status, { "content-type": mime[".json"], "cache-control": "no-store", ...headers }); res.end(JSON.stringify(payload)); };
const readBody = (req) => new Promise((resolve, reject) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; if (raw.length > 1_000_000) reject(Object.assign(new Error("Payload too large"), { status: 413 })); });
  req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); } });
});
const cookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(";").filter(Boolean).map((part) => { const index = part.indexOf("="); return [part.slice(0,index).trim(), decodeURIComponent(part.slice(index+1))]; }));
const cookieHeader = (token, clear = false) => `${sessionCookie}=${clear ? "" : encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}Max-Age=${clear ? 0 : Math.floor(sessionTtlMs/1000)}`;
const requestIp = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
const requireUser = async (req, admin = false) => {
  const user = await getSessionUser(cookies(req)[sessionCookie]);
  if (!user) throw Object.assign(new Error("로그인이 필요합니다."), { status: 401 });
  if (admin && user.role !== "admin") throw Object.assign(new Error("관리자 권한이 필요합니다."), { status: 403 });
  return user;
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname === "/api/health") return sendJson(res, 200, { status: "ok", database: pool ? "postgresql" : "memory" });
    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const { username, password } = await readBody(req);
      const user = await findUserByUsername(username);
      const allowed = user && user.status === "active" && await verifyPassword(String(password || ""), user.password_hash);
      if (!allowed) return sendJson(res, 401, { message: "계정 ID 또는 비밀번호를 확인해 주세요." });
      const token = await createSession(user.id);
      await writeAudit(user.id, "auth.login", "user", user.id, {}, requestIp(req));
      return sendJson(res, 200, { user: publicUser(user) }, { "set-cookie": cookieHeader(token) });
    }
    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      await deleteSession(cookies(req)[sessionCookie]);
      return sendJson(res, 200, { success: true }, { "set-cookie": cookieHeader("", true) });
    }
    if (url.pathname === "/api/auth/me" && req.method === "GET") return sendJson(res, 200, { user: publicUser(await requireUser(req)) });
    if (url.pathname === "/api/calendar/events" && req.method === "GET") { await requireUser(req); return sendJson(res, 200, await fetchCalendarEvents(url.searchParams.get("month"))); }
    if (url.pathname === "/api/admin/calendar/settings" && req.method === "GET") { await requireUser(req, true); return sendJson(res, 200, publicCalendarSettings(await getCalendarSettingsRow())); }
    if (url.pathname === "/api/admin/calendar/settings" && req.method === "PUT") { const actor = await requireUser(req, true); return sendJson(res, 200, await saveCalendarSettings(await readBody(req), actor, requestIp(req))); }
    if (url.pathname === "/api/admin/calendar/test" && req.method === "POST") { await requireUser(req, true); const result = await fetchCalendarEvents(url.searchParams.get("month")); return sendJson(res, 200, { success: result.connected, event_count: result.events.length, message: result.connected ? `${result.events.length}개의 일정을 확인했습니다.` : result.message }); }
    if (url.pathname === "/api/admin/calendar/oauth/start" && req.method === "POST") { const actor = await requireUser(req, true); return sendJson(res, 200, await startCalendarOAuth(actor, requestIp(req))); }
    if (url.pathname === "/api/calendar/oauth/callback" && req.method === "GET") {
      if (url.searchParams.get("error")) { res.writeHead(302, { location: "/?calendar=denied" }); return res.end(); }
      await exchangeCalendarOAuthCode(url.searchParams.get("code"), url.searchParams.get("state"));
      res.writeHead(302, { location: "/?calendar=connected" }); return res.end();
    }
    if (url.pathname === "/api/quick-links" && req.method === "GET") { const user = await requireUser(req); return sendJson(res, 200, await getQuickLinks(user.id)); }
    if (url.pathname === "/api/quick-links" && req.method === "PUT") { const user = await requireUser(req); return sendJson(res, 200, await updateQuickLinks(await readBody(req), user, requestIp(req))); }
    if (url.pathname === "/api/menu" && req.method === "GET") { await requireUser(req); return sendJson(res, 200, await getMenuConfig()); }
    if (url.pathname === "/api/admin/menu" && req.method === "PATCH") { const actor = await requireUser(req, true); return sendJson(res, 200, await updateMenuLabels(await readBody(req), actor, requestIp(req))); }
    if (url.pathname === "/api/admin/menu" && req.method === "POST") { const actor = await requireUser(req, true); return sendJson(res, 201, await createMenuItem(await readBody(req), actor, requestIp(req))); }
    if (url.pathname === "/api/admin/users" && req.method === "GET") { await requireUser(req, true); return sendJson(res, 200, { users: await listUsers() }); }
    if (url.pathname === "/api/admin/users" && req.method === "POST") { const actor = await requireUser(req, true); return sendJson(res, 201, { user: await createUser(await readBody(req), actor, requestIp(req)) }); }
    const userMatch = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)$/i);
    if (userMatch && req.method === "PATCH") { const actor = await requireUser(req, true); return sendJson(res, 200, { user: await updateUser(userMatch[1], await readBody(req), actor, requestIp(req)) }); }
    if (url.pathname === "/api/webhooks/plaud" && req.method === "POST") { await readBody(req); return sendJson(res, 202, { accepted: true, preview: true }); }

    let relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    relative = normalize(relative).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(root, relative);
    if (!filePath.startsWith(root)) return sendJson(res, 403, { message: "Forbidden" });
    try {
      const file = await readFile(filePath);
      const extension = extname(filePath);
      res.writeHead(200, { "content-type": mime[extension] || "application/octet-stream", "cache-control": staticCacheControl(extension) });
      res.end(file);
    }
    catch {
      const index = await readFile(join(root, "index.html"));
      res.writeHead(200, { "content-type": mime[".html"], "cache-control": staticCacheControl(".html") });
      res.end(index);
    }
  } catch (error) {
    if (error?.code === "23505") return sendJson(res, 409, { message: "이미 사용 중인 계정 ID 또는 사번입니다." });
    if (error?.code === "23502") return sendJson(res, 400, { message: "필수 계정 정보를 모두 입력해 주세요." });
    console.error("Request failed", { method: req.method, path: req.url, code: error?.code, message: error?.message });
    sendJson(res, error.status || 500, { message: error.status ? error.message : "서버 처리 중 오류가 발생했습니다." });
  }
});

await initDatabase();
server.listen(port, "0.0.0.0", () => console.log(`MedPark One: http://localhost:${port} (${pool ? "PostgreSQL" : "memory"})`));
const shutdown = async () => { if (pool) await pool.end(); server.close(() => process.exit(0)); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
