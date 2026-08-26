import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
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
const memory = { users: new Map(), sessions: new Map(), audits: [], menuLabels: new Map() };
const editableMenuIds = new Set(["management", "marketing", "technology", "amarans", "meetings", "calendar"]);

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

const updateMenuLabels = async (input, actor, ip) => {
  const labels = input && typeof input.labels === "object" && !Array.isArray(input.labels) ? input.labels : null;
  if (!labels) throw Object.assign(new Error("수정할 카테고리 이름을 입력해 주세요."), { status: 400 });
  const normalized = {};
  for (const [id, raw] of Object.entries(labels)) {
    if (!editableMenuIds.has(id)) throw Object.assign(new Error("수정할 수 없는 카테고리입니다."), { status: 400 });
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
        await client.query("INSERT INTO portal_menu_labels (menu_id,label,updated_by) VALUES ($1,$2,$3) ON CONFLICT (menu_id) DO UPDATE SET label=EXCLUDED.label, updated_by=EXCLUDED.updated_by, updated_at=now()", [id,label,actor.id]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } else {
    Object.entries(normalized).forEach(([id, label]) => memory.menuLabels.set(id, label));
  }
  await writeAudit(actor.id, "menu.labels.update", "portal_menu", "navigation", { labels: normalized }, ip);
  return listMenuLabels();
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
    if (url.pathname === "/api/menu" && req.method === "GET") { await requireUser(req); return sendJson(res, 200, { labels: await listMenuLabels() }); }
    if (url.pathname === "/api/admin/menu" && req.method === "PATCH") { const actor = await requireUser(req, true); return sendJson(res, 200, { labels: await updateMenuLabels(await readBody(req), actor, requestIp(req)) }); }
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
