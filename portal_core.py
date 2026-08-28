import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

try:
    import psycopg2
    import psycopg2.extras
except ImportError:  # local smoke tests can use the in-memory backend
    psycopg2 = None

logger = logging.getLogger(__name__)

SESSION_COOKIE = "medpark_session"
SESSION_TTL = timedelta(hours=12)
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{4,30}$")
DB_ENABLED = bool(psycopg2) and all(os.environ.get(k) for k in ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"))

_database_state_lock = threading.Lock()
_database_init_started = False
_database_state = {
    "state": "pending" if DB_ENABLED else "ready",
    "attempts": 0,
    "admin_ready": not DB_ENABLED,
    "setup_required": False,
}

EDITABLE_MENU_IDS = {
    "group_workspace", "group_business", "group_collaboration",
    "management", "management_ar", "management_hr", "management_routine",
    "marketing", "marketing_allo", "marketing_dental", "marketing_medical", "marketing_aesthetic", "marketing_global",
    "technology", "technology_focus", "amarans", "meetings", "calendar",
}
MENU_GROUP_IDS = ["workspace", "business", "collaboration"]
BUILTIN_MEMBERSHIP = {
    "root": MENU_GROUP_IDS,
    "workspace": ["dashboard"],
    "business": ["management", "marketing", "technology"],
    "collaboration": ["amarans", "meetings", "calendar"],
    "management": ["management_ar", "management_hr", "management_routine"],
    "marketing": ["marketing_allo", "marketing_dental", "marketing_medical", "marketing_aesthetic", "marketing_global"],
    "technology": ["technology_focus"],
}
QUICK_LINKS = {
    "ar": {"id": "ar", "label": "미수채권", "icon": "₩", "url": "https://medprk-ar-dashboard.mycafe24.ai/"},
    "hr": {"id": "hr", "label": "HR", "icon": "♙", "url": "https://medprk-medpark-hr-maps.mycafe24.ai/"},
    "allo": {"id": "allo", "label": "MedPark-Allo", "icon": "◫", "url": "https://medprk-medpark-allo.mycafe24.ai/"},
    "global": {"id": "global", "label": "Global-MAPS", "icon": "◎", "url": "https://medprk-medpark-global-maps.mycafe24.ai/"},
    "tech": {"id": "tech", "label": "기술부 중점 업무", "icon": "◇", "url": "https://medprk-medpark-tech-conference-maps.mycafe24.ai/"},
}
DEFAULT_QUICK_LINKS = ["ar", "hr", "allo", "global"]

_memory = {
    "users": {}, "sessions": {}, "audit": [], "labels": {}, "order": {},
    "custom": {}, "quick": {},
}


class AppError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def iso(value):
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return value


def public_user(row):
    if not row:
        return None
    return {
        "id": str(row["id"]), "username": row["username"], "email": row.get("email") or "",
        "name": row["name"], "employee_no": row.get("employee_no") or "",
        "department": row.get("department") or "", "role": row["role"],
        "status": row["status"], "created_at": iso(row.get("created_at")),
    }


def hash_password(password):
    salt = secrets.token_hex(16)
    derived = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64)
    return f"scrypt${salt}${derived.hex()}"


def verify_password(password, encoded):
    try:
        algorithm, salt, expected = str(encoded or "").split("$", 2)
        if algorithm != "scrypt":
            return False
        derived = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64)
        return hmac.compare_digest(derived.hex(), expected)
    except (ValueError, TypeError):
        return False


def token_hash(token):
    return hashlib.sha256(str(token).encode()).hexdigest()


def _db_config():
    return {
        "host": os.environ.get("DB_HOST"), "port": int(os.environ.get("DB_PORT", "5432")),
        "dbname": os.environ.get("DB_NAME"), "user": os.environ.get("DB_USER"),
        "password": os.environ.get("DB_PASSWORD"), "connect_timeout": 10,
    }


@contextmanager
def connection():
    if not DB_ENABLED:
        yield None
        return
    conn = psycopg2.connect(**_db_config())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def fetchone(sql, params=(), conn=None):
    if not DB_ENABLED:
        return None
    owned = conn is None
    if owned:
        conn = psycopg2.connect(**_db_config())
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        if owned:
            conn.close()


def fetchall(sql, params=(), conn=None):
    if not DB_ENABLED:
        return []
    owned = conn is None
    if owned:
        conn = psycopg2.connect(**_db_config())
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(row) for row in cur.fetchall()]
    finally:
        if owned:
            conn.close()


def execute(sql, params=(), conn=None):
    if not DB_ENABLED:
        return None
    owned = conn is None
    if owned:
        conn = psycopg2.connect(**_db_config())
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            row = dict(cur.fetchone()) if cur.description and cur.rowcount else None
        if owned:
            conn.commit()
        return row
    except Exception:
        if owned:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


SCHEMA = """
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
CREATE TABLE IF NOT EXISTS portal_app_migrations (id varchar(100) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS portal_menu_order (
  menu_id varchar(50) PRIMARY KEY, parent_id varchar(50) NOT NULL, item_order integer NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS portal_custom_menu_items (
  id uuid PRIMARY KEY, parent_id varchar(50), label varchar(40) NOT NULL, icon varchar(8), url text,
  item_order integer NOT NULL DEFAULT 0, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_quick_links (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, system_id varchar(30) NOT NULL,
  position integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, system_id)
);
"""


def _set_database_state(**values):
    with _database_state_lock:
        _database_state.update(values)


def _database_admin_is_ready():
    """Reconcile per-worker readiness with the shared PostgreSQL state."""
    if not DB_ENABLED:
        return True
    try:
        with connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = '3000ms'")
                cur.execute("SELECT to_regclass('public.users')")
                if cur.fetchone()[0] is None:
                    return False
                cur.execute("SELECT EXISTS(SELECT 1 FROM users WHERE status='active' AND role='admin')")
                return bool(cur.fetchone()[0])
    except Exception:
        return False


def database_status():
    with _database_state_lock:
        state = dict(_database_state)

    # Gunicorn workers do not share Python memory. A worker that is waiting for
    # the initialization lock must still become ready when another worker has
    # already completed the shared PostgreSQL schema and administrator setup.
    if DB_ENABLED and state["state"] != "ready" and _database_admin_is_ready():
        _set_database_state(
            state="ready",
            admin_ready=True,
            setup_required=False,
        )
        with _database_state_lock:
            state = dict(_database_state)

    return {
        "database": "postgresql" if DB_ENABLED else "memory",
        "database_state": state["state"],
        "database_attempts": state["attempts"],
        "admin_ready": state["admin_ready"],
        "setup_required": state["setup_required"],
    }


def ensure_database_ready():
    state = database_status()
    if state["database_state"] == "ready":
        return
    if state["setup_required"]:
        raise AppError("초기 관리자 비밀번호 설정이 필요합니다.", 503)
    raise AppError("데이터베이스 초기화 중입니다. 잠시 후 다시 시도해 주세요.", 503)


def _initialize_database_once():
    password = os.environ.get("INITIAL_ADMIN_PASSWORD")
    with connection() as conn:
        with conn.cursor() as cur:
            # Gunicorn workers may start together. Never wait indefinitely for
            # another worker or an unrelated DDL transaction.
            cur.execute("SET LOCAL lock_timeout = '10000ms'")
            cur.execute("SET LOCAL statement_timeout = '60000ms'")
            cur.execute("SELECT pg_try_advisory_xact_lock(%s)", (778107,))
            if not cur.fetchone()[0]:
                raise RuntimeError("Database initialization lock is busy")
            cur.execute(SCHEMA)
            labels = {
                "group_workspace": "WORKSPACE", "group_business": "BUSINESS", "group_collaboration": "COLLABORATION",
                "management": "경영사업본부", "marketing": "마케팅 사업본부", "technology": "기술사업본부",
                "amarans": "아마란스", "meetings": "회의록", "calendar": "일정(캘린더)",
            }
            for menu_id, label in labels.items():
                cur.execute("INSERT INTO portal_menu_labels(menu_id,label) VALUES(%s,%s) ON CONFLICT(menu_id) DO NOTHING", (menu_id, label))
            cur.execute("SELECT count(*) FROM users WHERE status='active' AND role='admin'")
            admin_ready = cur.fetchone()[0] > 0
            if not admin_ready and password and len(password) >= 12:
                cur.execute(
                    "INSERT INTO users(id,username,email,password_hash,name,employee_no,department,role,status) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (str(uuid.uuid4()), "admin", None, hash_password(password), "관리자", "M001", "경영사업본부", "admin", "active"),
                )
                admin_ready = True
    return admin_ready


def _database_init_worker(max_attempts=30):
    for attempt in range(1, max_attempts + 1):
        _set_database_state(state="initializing", attempts=attempt, setup_required=False)
        try:
            admin_ready = _initialize_database_once()
            _set_database_state(
                state="ready" if admin_ready else "setup_required",
                admin_ready=admin_ready,
                setup_required=not admin_ready,
            )
            return
        except Exception:
            logger.exception("Database initialization attempt %s failed", attempt)
            _set_database_state(state="retrying")
            if attempt == max_attempts:
                _set_database_state(state="error")
                return
            time.sleep(min(2 + attempt, 10))


def init_database():
    global _database_init_started
    if DB_ENABLED:
        with _database_state_lock:
            if _database_init_started:
                return
            _database_init_started = True
        threading.Thread(target=_database_init_worker, name="portal-db-init", daemon=True).start()
        return

    if _memory["users"]:
        return
    password = os.environ.get("INITIAL_ADMIN_PASSWORD", "LocalTestOnly!234")
    user_id = str(uuid.uuid4())
    _memory["users"][user_id] = {
        "id": user_id, "username": "admin", "email": "", "password_hash": hash_password(password),
        "name": "관리자", "employee_no": "M001", "department": "경영사업본부",
        "role": "admin", "status": "active", "created_at": datetime.now(timezone.utc),
    }


def find_user_by_username(username):
    value = str(username or "").lower()
    if DB_ENABLED:
        return fetchone("SELECT * FROM users WHERE lower(username)=%s LIMIT 1", (value,))
    return next((u for u in _memory["users"].values() if u["username"].lower() == value), None)


def find_user_by_id(user_id):
    if DB_ENABLED:
        return fetchone("SELECT * FROM users WHERE id=%s", (user_id,))
    return _memory["users"].get(str(user_id))


def list_users():
    rows = fetchall("SELECT * FROM users ORDER BY created_at DESC") if DB_ENABLED else list(_memory["users"].values())
    return [public_user(row) for row in rows]


def write_audit(actor_id, action, target_type, target_id, metadata=None, ip=None):
    metadata = metadata or {}
    if DB_ENABLED:
        execute("INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,metadata,ip_address) VALUES(%s,%s,%s,%s,%s,%s)", (actor_id, action, target_type, target_id, json.dumps(metadata, ensure_ascii=False), ip or None))
    else:
        _memory["audit"].append({"actor": actor_id, "action": action, "target": target_id, "metadata": metadata})


def create_session(user_id):
    token = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
    expires = datetime.now(timezone.utc) + SESSION_TTL
    if DB_ENABLED:
        execute("INSERT INTO portal_sessions(token_hash,user_id,expires_at) VALUES(%s,%s,%s)", (token_hash(token), user_id, expires))
    else:
        _memory["sessions"][token_hash(token)] = {"user_id": str(user_id), "expires": expires}
    return token


def get_session_user(token):
    if not token:
        return None
    hashed = token_hash(token)
    if DB_ENABLED:
        return fetchone("SELECT u.* FROM portal_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>now() AND u.status='active'", (hashed,))
    session = _memory["sessions"].get(hashed)
    if not session or session["expires"] <= datetime.now(timezone.utc):
        return None
    return find_user_by_id(session["user_id"])


def delete_session(token):
    if not token:
        return
    hashed = token_hash(token)
    if DB_ENABLED:
        execute("DELETE FROM portal_sessions WHERE token_hash=%s", (hashed,))
    else:
        _memory["sessions"].pop(hashed, None)


def menu_config():
    if DB_ENABLED:
        labels = {row["menu_id"]: row["label"] for row in fetchall("SELECT menu_id,label FROM portal_menu_labels")}
        custom = fetchall("SELECT id::text,parent_id,label,icon,url,item_order FROM portal_custom_menu_items ORDER BY item_order,created_at")
        order_rows = fetchall("SELECT menu_id,parent_id,item_order FROM portal_menu_order ORDER BY parent_id,item_order")
    else:
        labels, custom, order_rows = dict(_memory["labels"]), list(_memory["custom"].values()), list(_memory["order"].values())
    order = {row["menu_id"]: {"parent_id": row["parent_id"], "item_order": int(row["item_order"])} for row in order_rows}
    return {"labels": labels, "customItems": custom, "order": order}


def current_membership():
    membership = {scope: list(ids) for scope, ids in BUILTIN_MEMBERSHIP.items()}
    for item in menu_config()["customItems"]:
        scope = item.get("parent_id") or "business"
        membership.setdefault(scope, []).append(str(item["id"]))
        membership.setdefault(str(item["id"]), [])
    return membership


def normalize_menu_url(raw):
    value = str(raw or "").strip()
    if not value:
        return None
    if value.startswith("/") and not value.startswith("//"):
        return value
    if not re.match(r"^https?://", value, re.I):
        raise AppError("연결 URL은 내부 경로 또는 http/https 주소만 사용할 수 있습니다.")
    return value


def update_menu_labels(data, actor, ip):
    labels = data.get("labels") if isinstance(data, dict) else None
    if not isinstance(labels, dict):
        raise AppError("수정할 카테고리 이름을 입력해 주세요.")
    custom_ids = {str(item["id"]) for item in menu_config()["customItems"]}
    normalized = {}
    for menu_id, raw in labels.items():
        if menu_id not in EDITABLE_MENU_IDS and menu_id not in custom_ids:
            raise AppError("수정할 수 없는 카테고리입니다.")
        label = str(raw or "").strip()
        if not label or len(label) > 40:
            raise AppError("카테고리 이름은 1~40자로 입력해 주세요.")
        normalized[menu_id] = label
    if DB_ENABLED:
        with connection() as conn:
            with conn.cursor() as cur:
                for menu_id, label in normalized.items():
                    if menu_id in EDITABLE_MENU_IDS:
                        cur.execute("INSERT INTO portal_menu_labels(menu_id,label,updated_by) VALUES(%s,%s,%s) ON CONFLICT(menu_id) DO UPDATE SET label=excluded.label,updated_by=excluded.updated_by,updated_at=now()", (menu_id, label, actor["id"]))
                    else:
                        cur.execute("UPDATE portal_custom_menu_items SET label=%s,updated_at=now() WHERE id::text=%s", (label, menu_id))
    else:
        for menu_id, label in normalized.items():
            if menu_id in EDITABLE_MENU_IDS:
                _memory["labels"][menu_id] = label
            else:
                _memory["custom"][menu_id]["label"] = label
    write_audit(actor["id"], "menu.labels.update", "portal_menu", "navigation", {"labels": normalized}, ip)
    return menu_config()


def create_menu_item(data, actor, ip):
    label = str(data.get("label") or "").strip()
    group_id = str(data.get("group_id") or "").strip()
    parent_id = str(data.get("parent_id") or "").strip() or group_id
    icon = (str(data.get("icon") or "").strip()[:2] or "◇")
    url = normalize_menu_url(data.get("url"))
    if not label or len(label) > 40:
        raise AppError("카테고리 이름은 1~40자로 입력해 주세요.")
    if group_id not in MENU_GROUP_IDS:
        raise AppError("소속 최상단 카테고리를 선택해 주세요.")
    membership = current_membership()
    if parent_id != group_id and parent_id not in membership.get(group_id, []):
        raise AppError("선택한 최상단과 상위 카테고리가 일치하지 않습니다.")
    item_id = str(uuid.uuid4())
    siblings = [item for item in menu_config()["customItems"] if item.get("parent_id") == parent_id]
    item_order = max([int(item.get("item_order", 0)) for item in siblings] + [0]) + 1
    if DB_ENABLED:
        execute("INSERT INTO portal_custom_menu_items(id,parent_id,label,icon,url,item_order,created_by) VALUES(%s,%s,%s,%s,%s,%s,%s)", (item_id, parent_id, label, icon, url, item_order, actor["id"]))
    else:
        _memory["custom"][item_id] = {"id": item_id, "parent_id": parent_id, "label": label, "icon": icon, "url": url, "item_order": item_order}
    write_audit(actor["id"], "menu.item.create", "portal_menu", item_id, {"parent_id": parent_id, "label": label, "url": bool(url)}, ip)
    result = menu_config()
    result["item"] = {"id": item_id, "parent_id": parent_id, "label": label, "icon": icon, "url": url, "item_order": item_order}
    return result


def update_menu_order(data, actor, ip):
    scopes = data.get("scopes") if isinstance(data, dict) else None
    if not isinstance(scopes, dict):
        raise AppError("저장할 카테고리 순서를 확인해 주세요.")
    membership = current_membership()
    normalized = {}
    for scope, expected in membership.items():
        if scope not in scopes:
            continue
        ids = [str(value) for value in scopes[scope]] if isinstance(scopes[scope], list) else []
        if len(ids) != len(set(ids)) or set(ids) != set(expected):
            raise AppError("카테고리 구성과 순서가 일치하지 않습니다. 화면을 새로고침한 후 다시 시도해 주세요.")
        normalized[scope] = ids
    if "root" not in normalized or any(group not in normalized["root"] for group in MENU_GROUP_IDS):
        raise AppError("최상위 카테고리 순서를 확인해 주세요.")
    rows = [(menu_id, parent_id, index) for parent_id, ids in normalized.items() for index, menu_id in enumerate(ids)]
    if DB_ENABLED:
        with connection() as conn:
            with conn.cursor() as cur:
                for menu_id, parent_id, item_order in rows:
                    cur.execute("INSERT INTO portal_menu_order(menu_id,parent_id,item_order,updated_by) VALUES(%s,%s,%s,%s) ON CONFLICT(menu_id) DO UPDATE SET parent_id=excluded.parent_id,item_order=excluded.item_order,updated_by=excluded.updated_by,updated_at=now()", (menu_id, parent_id, item_order, actor["id"]))
    else:
        for menu_id, parent_id, item_order in rows:
            _memory["order"][menu_id] = {"menu_id": menu_id, "parent_id": parent_id, "item_order": item_order}
    write_audit(actor["id"], "menu.order.update", "portal_menu", "navigation", {"scopes": normalized}, ip)
    return menu_config()


def get_quick_links(user_id):
    if DB_ENABLED:
        ids = [row["system_id"] for row in fetchall("SELECT system_id FROM user_quick_links WHERE user_id=%s ORDER BY position", (user_id,))]
    else:
        ids = _memory["quick"].get(str(user_id), [])
    ids = ids or DEFAULT_QUICK_LINKS
    return {"links": [QUICK_LINKS[value] for value in ids if value in QUICK_LINKS], "catalog": list(QUICK_LINKS.values())}


def update_quick_links(data, user, ip):
    ids = list(dict.fromkeys(str(value) for value in (data.get("system_ids") or [])))
    if not ids or len(ids) > 5 or any(value not in QUICK_LINKS for value in ids):
        raise AppError("자주 찾는 시스템은 1~5개를 선택해 주세요.")
    if DB_ENABLED:
        with connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM user_quick_links WHERE user_id=%s", (user["id"],))
                for position, value in enumerate(ids):
                    cur.execute("INSERT INTO user_quick_links(user_id,system_id,position) VALUES(%s,%s,%s)", (user["id"], value, position))
    else:
        _memory["quick"][str(user["id"])] = ids
    write_audit(user["id"], "user.quick_links.update", "user", str(user["id"]), {"system_ids": ids}, ip)
    return get_quick_links(user["id"])


def create_user(data, actor, ip):
    username = str(data.get("username") or "").strip().lower()
    password = str(data.get("password") or "")
    name = str(data.get("name") or "").strip()
    role = "admin" if data.get("role") == "admin" else "basic"
    if not USERNAME_RE.match(username):
        raise AppError("계정 ID는 영문자·숫자·._- 조합 4~30자로 입력해 주세요.")
    if len(password) < 8:
        raise AppError("초기 비밀번호는 8자 이상이어야 합니다.")
    if not name:
        raise AppError("성명을 입력해 주세요.")
    if find_user_by_username(username):
        raise AppError("이미 사용 중인 계정 ID입니다.", 409)
    user = {
        "id": str(uuid.uuid4()), "username": username, "email": str(data.get("email") or "").strip() or None,
        "password_hash": hash_password(password), "name": name,
        "employee_no": str(data.get("employee_no") or "").strip() or None,
        "department": str(data.get("department") or "").strip() or None,
        "role": role, "status": "active", "created_at": datetime.now(timezone.utc),
    }
    if DB_ENABLED:
        row = execute("INSERT INTO users(id,username,email,password_hash,name,employee_no,department,role,status) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *", (user["id"], user["username"], user["email"], user["password_hash"], user["name"], user["employee_no"], user["department"], user["role"], user["status"]))
        user = row
    else:
        _memory["users"][user["id"]] = user
    write_audit(actor["id"], "user.create", "user", str(user["id"]), {"username": username, "role": role}, ip)
    return public_user(user)


def update_user(user_id, data, actor, ip):
    existing = find_user_by_id(user_id)
    if not existing:
        raise AppError("계정을 찾을 수 없습니다.", 404)
    values = {
        "name": str(data.get("name", existing["name"]) or "").strip(),
        "employee_no": str(data.get("employee_no", existing.get("employee_no") or "")).strip() or None,
        "department": str(data.get("department", existing.get("department") or "")).strip() or None,
        "email": str(data.get("email", existing.get("email") or "")).strip() or None,
        "role": data.get("role") if data.get("role") in ("admin", "basic") else existing["role"],
        "status": data.get("status") if data.get("status") in ("active", "terminated") else existing["status"],
    }
    if not values["name"]:
        raise AppError("성명을 입력해 주세요.")
    if str(actor["id"]) == str(user_id) and values["role"] != "admin":
        raise AppError("현재 로그인한 관리자의 권한은 해제할 수 없습니다.")
    password = str(data.get("password") or "")
    if password and len(password) < 8:
        raise AppError("비밀번호는 8자 이상이어야 합니다.")
    if DB_ENABLED:
        assignments, params = [], []
        for key in ("name", "employee_no", "department", "email", "role", "status"):
            if key in data:
                assignments.append(f"{key}=%s")
                params.append(values[key])
        if "status" in data:
            assignments.append("terminated_at=%s")
            params.append(datetime.now(timezone.utc) if values["status"] == "terminated" else None)
        if password:
            assignments.extend(["password_hash=%s", "password_changed_at=now()"])
            params.append(hash_password(password))
        if assignments:
            params.append(user_id)
            row = execute(f"UPDATE users SET {','.join(assignments)},updated_at=now() WHERE id=%s RETURNING *", tuple(params))
        else:
            row = existing
        if values["status"] == "terminated" or password:
            execute("DELETE FROM portal_sessions WHERE user_id=%s", (user_id,))
    else:
        existing.update({key: value for key, value in values.items() if key in data})
        if password:
            existing["password_hash"] = hash_password(password)
        row = existing
        if values["status"] == "terminated" or password:
            for key, item in list(_memory["sessions"].items()):
                if item["user_id"] == str(user_id):
                    _memory["sessions"].pop(key, None)
    write_audit(actor["id"], "user.update", "user", str(user_id), {"password_reset": bool(password)}, ip)
    return public_user(row)
