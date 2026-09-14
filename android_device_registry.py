import hashlib
import re
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone

from flask import jsonify, request

import portal_core as core


_schema_lock = threading.Lock()
_schema_ready = False
_memory_devices = {}


def _now():
    return datetime.now(timezone.utc)


def _ensure_schema():
    global _schema_ready
    if _schema_ready or not core.DB_ENABLED:
        return
    with _schema_lock:
        if _schema_ready:
            return
        core.execute(
            """
            CREATE TABLE IF NOT EXISTS android_device_registry (
              id uuid PRIMARY KEY,
              assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
              device_name varchar(120) NOT NULL,
              manufacturer varchar(80),
              model varchar(120),
              android_version varchar(40),
              app_version varchar(40),
              install_id varchar(180) UNIQUE,
              status varchar(30) NOT NULL DEFAULT 'pending',
              registration_code_hash char(64),
              registration_expires_at timestamptz,
              claimed_at timestamptz,
              last_seen_at timestamptz,
              active boolean NOT NULL DEFAULT true,
              registered_by uuid REFERENCES users(id) ON DELETE SET NULL,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS idx_android_device_registry_active
              ON android_device_registry(active, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_android_device_registry_user
              ON android_device_registry(assigned_user_id, active);
            CREATE INDEX IF NOT EXISTS idx_android_device_registry_status
              ON android_device_registry(status, registration_expires_at);
            """
        )
        _schema_ready = True


def _actor(admin=False):
    core.ensure_database_ready()
    _ensure_schema()
    user = core.get_session_user(request.cookies.get(core.SESSION_COOKIE))
    if not user:
        raise core.AppError("로그인이 필요합니다.", 401)
    if admin and user.get("role") != "admin":
        raise core.AppError("Android 단말 등록/관리는 관리자 권한이 필요합니다.", 403)
    return user


def _clean(value, limit=120):
    return re.sub(r"\s+", " ", str(value or "").strip())[:limit]


def _active_user(user_id):
    value = str(user_id or "").strip()
    try:
        uuid.UUID(value)
    except (TypeError, ValueError) as exc:
        raise core.AppError("Android 단말을 사용할 임직원을 선택해 주세요.") from exc
    if core.DB_ENABLED:
        user = core.fetchone("SELECT * FROM users WHERE id=%s AND status='active' LIMIT 1", (value,))
    else:
        user = core.find_user_by_id(value)
        if user and user.get("status") != "active":
            user = None
    if not user:
        raise core.AppError("활성 임직원 계정을 찾을 수 없습니다.", 404)
    return user


def _list_users():
    if core.DB_ENABLED:
        rows = core.fetchall(
            """SELECT id::text, username, name, email, department
               FROM users WHERE status='active' ORDER BY name, username"""
        ) or []
    else:
        rows = [
            {
                "id": str(user["id"]),
                "username": user.get("username") or "",
                "name": user.get("name") or "",
                "email": user.get("email") or "",
                "department": user.get("department") or "",
            }
            for user in core._memory["users"].values()
            if user.get("status") == "active"
        ]
    return rows


def _registration_code():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    raw = "".join(secrets.choice(alphabet) for _ in range(12))
    return f"{raw[:4]}-{raw[4:8]}-{raw[8:12]}"


def _hash_code(value):
    normalized = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    if len(normalized) != 12:
        raise core.AppError("Android 등록코드는 12자리 코드입니다.")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _partner_user_id(user):
    candidate = str(user.get("email") or user.get("username") or "").strip()
    if len(candidate) >= 6:
        return candidate[:255]
    username = re.sub(r"[^A-Za-z0-9._-]", "", str(user.get("username") or "user"))
    return f"MPK-{username}"[:255]


def _find(device_id):
    value = str(device_id)
    if core.DB_ENABLED:
        return core.fetchone(
            """SELECT d.*, u.name AS assigned_user_name, u.username AS assigned_username,
                      u.email AS assigned_email, u.department AS assigned_department
               FROM android_device_registry d
               LEFT JOIN users u ON u.id=d.assigned_user_id
               WHERE d.id=%s LIMIT 1""",
            (value,),
        )
    row = _memory_devices.get(value)
    if not row:
        return None
    user = core.find_user_by_id(row.get("assigned_user_id")) or {}
    return {
        **row,
        "assigned_user_name": user.get("name") or "",
        "assigned_username": user.get("username") or "",
        "assigned_email": user.get("email") or "",
        "assigned_department": user.get("department") or "",
    }


def _public(row):
    if not row:
        return None
    return {
        "id": str(row.get("id")),
        "assigned_user_id": str(row.get("assigned_user_id") or ""),
        "assigned_user_name": row.get("assigned_user_name") or "",
        "assigned_username": row.get("assigned_username") or "",
        "assigned_department": row.get("assigned_department") or "",
        "device_name": row.get("device_name") or "",
        "manufacturer": row.get("manufacturer") or "",
        "model": row.get("model") or "",
        "android_version": row.get("android_version") or "",
        "app_version": row.get("app_version") or "",
        "install_id": row.get("install_id") or "",
        "status": row.get("status") or "pending",
        "registration_expires_at": core.iso(row.get("registration_expires_at")),
        "claimed_at": core.iso(row.get("claimed_at")),
        "last_seen_at": core.iso(row.get("last_seen_at")),
        "active": bool(row.get("active", True)),
        "created_at": core.iso(row.get("created_at")),
        "updated_at": core.iso(row.get("updated_at")),
    }


def list_devices(actor):
    if core.DB_ENABLED:
        rows = core.fetchall(
            """SELECT d.*, u.name AS assigned_user_name, u.username AS assigned_username,
                      u.email AS assigned_email, u.department AS assigned_department
               FROM android_device_registry d
               LEFT JOIN users u ON u.id=d.assigned_user_id
               WHERE d.active=true
               ORDER BY d.updated_at DESC, d.created_at DESC"""
        ) or []
    else:
        rows = [_find(key) for key in _memory_devices if _memory_devices[key].get("active")]
    return {
        "items": [_public(row) for row in rows if row],
        "users": _list_users(),
        "can_manage": actor.get("role") == "admin",
        "claim_endpoint": "/api/android-devices/claim",
    }


def create_pending(data, actor, ip):
    assigned = _active_user(data.get("assigned_user_id"))
    device_name = _clean(data.get("device_name"), 120) or f"{assigned.get('name') or assigned.get('username')} Android"
    device_id = str(uuid.uuid4())
    code = _registration_code()
    code_hash = _hash_code(code)
    expires_at = _now() + timedelta(minutes=30)
    if core.DB_ENABLED:
        core.execute(
            """INSERT INTO android_device_registry(
                 id,assigned_user_id,device_name,status,registration_code_hash,
                 registration_expires_at,registered_by
               ) VALUES(%s,%s,%s,'pending',%s,%s,%s) RETURNING id""",
            (device_id, str(assigned["id"]), device_name, code_hash, expires_at, str(actor["id"])),
        )
    else:
        now = _now()
        _memory_devices[device_id] = {
            "id": device_id,
            "assigned_user_id": str(assigned["id"]),
            "device_name": device_name,
            "status": "pending",
            "registration_code_hash": code_hash,
            "registration_expires_at": expires_at,
            "registered_by": str(actor["id"]),
            "active": True,
            "created_at": now,
            "updated_at": now,
        }
    core.write_audit(
        actor["id"], "android.device.registration_code.create", "android_device", device_id,
        {"assigned_user_id": str(assigned["id"])}, ip,
    )
    return {"device": _public(_find(device_id)), "registration_code": code, "expires_in_minutes": 30}


def refresh_code(device_id, actor, ip):
    row = _find(device_id)
    if not row or not row.get("active"):
        raise core.AppError("Android 등록 단말을 찾을 수 없습니다.", 404)
    code = _registration_code()
    code_hash = _hash_code(code)
    expires_at = _now() + timedelta(minutes=30)
    if core.DB_ENABLED:
        core.execute(
            """UPDATE android_device_registry
               SET status='pending',registration_code_hash=%s,registration_expires_at=%s,
                   install_id=NULL,manufacturer=NULL,model=NULL,android_version=NULL,
                   app_version=NULL,claimed_at=NULL,last_seen_at=NULL,updated_at=now()
               WHERE id=%s RETURNING id""",
            (code_hash, expires_at, str(device_id)),
        )
    else:
        _memory_devices[str(device_id)].update({
            "status": "pending",
            "registration_code_hash": code_hash,
            "registration_expires_at": expires_at,
            "install_id": None,
            "manufacturer": None,
            "model": None,
            "android_version": None,
            "app_version": None,
            "claimed_at": None,
            "last_seen_at": None,
            "updated_at": _now(),
        })
    core.write_audit(actor["id"], "android.device.registration_code.refresh", "android_device", str(device_id), {}, ip)
    return {"device": _public(_find(device_id)), "registration_code": code, "expires_in_minutes": 30}


def _find_by_code(code_hash):
    now = _now()
    if core.DB_ENABLED:
        return core.fetchone(
            """SELECT d.*, u.name AS assigned_user_name, u.username AS assigned_username,
                      u.email AS assigned_email, u.department AS assigned_department
               FROM android_device_registry d
               LEFT JOIN users u ON u.id=d.assigned_user_id
               WHERE d.active=true AND d.status='pending'
                 AND d.registration_code_hash=%s
                 AND d.registration_expires_at>%s
               ORDER BY d.created_at DESC LIMIT 1""",
            (code_hash, now),
        )
    for key, row in _memory_devices.items():
        if not row.get("active") or row.get("status") != "pending":
            continue
        if row.get("registration_code_hash") != code_hash:
            continue
        expires = row.get("registration_expires_at")
        if expires and expires > now:
            return _find(key)
    return None


def claim_device(data, ip):
    code_hash = _hash_code(data.get("registration_code"))
    row = _find_by_code(code_hash)
    if not row:
        raise core.AppError("등록코드가 만료되었거나 올바르지 않습니다. 관리자에게 새 코드를 요청해 주세요.", 404)
    install_id = re.sub(r"[^A-Za-z0-9._:-]", "", str(data.get("install_id") or "").strip())[:180]
    if len(install_id) < 8:
        raise core.AppError("Android 앱 설치 식별값을 확인할 수 없습니다.")
    manufacturer = _clean(data.get("manufacturer"), 80)
    model = _clean(data.get("model"), 120)
    android_version = _clean(data.get("android_version"), 40)
    app_version = _clean(data.get("app_version"), 40)
    if core.DB_ENABLED:
        existing = core.fetchone(
            "SELECT id FROM android_device_registry WHERE install_id=%s AND active=true AND id<>%s LIMIT 1",
            (install_id, str(row["id"])),
        )
        if existing:
            raise core.AppError("이미 다른 사용자에게 등록된 Android 앱 설치입니다.", 409)
        core.execute(
            """UPDATE android_device_registry
               SET install_id=%s,manufacturer=%s,model=%s,android_version=%s,app_version=%s,
                   status='registered',registration_code_hash=NULL,registration_expires_at=NULL,
                   claimed_at=now(),last_seen_at=now(),updated_at=now()
               WHERE id=%s RETURNING id""",
            (install_id, manufacturer, model, android_version, app_version, str(row["id"])),
        )
    else:
        for key, other in _memory_devices.items():
            if key != str(row["id"]) and other.get("active") and other.get("install_id") == install_id:
                raise core.AppError("이미 다른 사용자에게 등록된 Android 앱 설치입니다.", 409)
        _memory_devices[str(row["id"])].update({
            "install_id": install_id,
            "manufacturer": manufacturer,
            "model": model,
            "android_version": android_version,
            "app_version": app_version,
            "status": "registered",
            "registration_code_hash": None,
            "registration_expires_at": None,
            "claimed_at": _now(),
            "last_seen_at": _now(),
            "updated_at": _now(),
        })
    assigned = _active_user(row.get("assigned_user_id"))
    core.write_audit(
        assigned["id"], "android.device.claim", "android_device", str(row["id"]),
        {"install_id_suffix": install_id[-8:]}, ip,
    )
    device = _public(_find(row["id"]))
    return {
        "success": True,
        "device": device,
        "assigned_user": {
            "id": str(assigned["id"]),
            "name": assigned.get("name") or assigned.get("username"),
            "partner_user_id": _partner_user_id(assigned),
        },
    }


def archive_device(device_id, actor, ip):
    row = _find(device_id)
    if not row or not row.get("active"):
        raise core.AppError("Android 등록 단말을 찾을 수 없습니다.", 404)
    if core.DB_ENABLED:
        core.execute("UPDATE android_device_registry SET active=false,updated_at=now() WHERE id=%s RETURNING id", (str(device_id),))
    else:
        _memory_devices[str(device_id)].update({"active": False, "updated_at": _now()})
    core.write_audit(actor["id"], "android.device.archive", "android_device", str(device_id), {}, ip)
    return {"success": True, "device_id": str(device_id)}


def install(app):
    if "android_devices_list" in app.view_functions:
        return

    def response(data, status=200):
        resp = jsonify(data)
        resp.status_code = status
        resp.headers["Cache-Control"] = "no-store"
        return resp

    def client_ip():
        return (request.headers.get("X-Forwarded-For") or request.remote_addr or "").split(",")[0].strip()

    def api_list():
        actor = _actor(True)
        return response(list_devices(actor))

    def api_create():
        actor = _actor(True)
        return response(create_pending(request.get_json(silent=True) or {}, actor, client_ip()), 201)

    def api_refresh(device_id):
        actor = _actor(True)
        return response(refresh_code(str(device_id), actor, client_ip()))

    def api_delete(device_id):
        actor = _actor(True)
        return response(archive_device(str(device_id), actor, client_ip()))

    def api_claim():
        core.ensure_database_ready()
        _ensure_schema()
        return response(claim_device(request.get_json(silent=True) or {}, client_ip()))

    app.add_url_rule("/api/android-devices", "android_devices_list", api_list, methods=["GET"])
    app.add_url_rule("/api/android-devices", "android_devices_create", api_create, methods=["POST"])
    app.add_url_rule("/api/android-devices/<uuid:device_id>/code", "android_devices_refresh_code", api_refresh, methods=["POST"])
    app.add_url_rule("/api/android-devices/<uuid:device_id>", "android_devices_delete", api_delete, methods=["DELETE"])
    app.add_url_rule("/api/android-devices/claim", "android_devices_claim", api_claim, methods=["POST"])
