import hashlib
import json
import re
import threading
import uuid
from datetime import datetime, timezone

from flask import jsonify, request

import portal_core as core
import plaud_integration as plaud


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
            CREATE TABLE IF NOT EXISTS plaud_device_registry (
              id uuid PRIMARY KEY,
              serial_number varchar(128) UNIQUE NOT NULL,
              device_name varchar(120) NOT NULL,
              model varchar(80),
              device_type varchar(40) NOT NULL,
              assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
              partner_user_id varchar(255) NOT NULL,
              bind_status varchar(30) NOT NULL DEFAULT 'registered',
              ble_status varchar(30) NOT NULL DEFAULT 'not_connected',
              firmware_version varchar(50),
              last_seen_at timestamptz,
              bound_at timestamptz,
              unbound_at timestamptz,
              cloud_is_bind boolean,
              cloud_bind_history jsonb NOT NULL DEFAULT '[]'::jsonb,
              last_cloud_check_at timestamptz,
              last_error text,
              active boolean NOT NULL DEFAULT true,
              registered_by uuid REFERENCES users(id) ON DELETE SET NULL,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS idx_plaud_device_registry_active
              ON plaud_device_registry(active, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_plaud_device_registry_user
              ON plaud_device_registry(assigned_user_id, active);
            CREATE INDEX IF NOT EXISTS idx_plaud_device_registry_partner_user
              ON plaud_device_registry(partner_user_id, active);
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
        raise core.AppError("PLAUD 기기 등록/바인딩은 관리자 권한이 필요합니다.", 403)
    return user


def _clean_text(value, limit=120):
    return re.sub(r"\s+", " ", str(value or "").strip())[:limit]


def _serial(value):
    serial = re.sub(r"[^A-Za-z0-9._:-]", "", str(value or "").strip())[:128]
    if len(serial) < 4:
        raise core.AppError("PLAUD 기기 Serial Number를 확인해 주세요.")
    return serial


def _device_type(serial, requested=None):
    value = _clean_text(requested, 40).lower()
    if value in {"notepro", "notepins"}:
        return value
    if serial.startswith("881"):
        return "notepro"
    if serial.startswith("882"):
        return "notepins"
    raise core.AppError("Device Type을 선택해 주세요. 현재 지원값은 notepro 또는 notepins입니다.")


def _active_user(user_id):
    value = str(user_id or "").strip()
    try:
        uuid.UUID(value)
    except (ValueError, TypeError) as exc:
        raise core.AppError("할당할 임직원을 선택해 주세요.") from exc
    if core.DB_ENABLED:
        user = core.fetchone(
            "SELECT * FROM users WHERE id=%s AND status='active' LIMIT 1",
            (value,),
        )
    else:
        user = core.find_user_by_id(value)
        if user and user.get("status") != "active":
            user = None
    if not user:
        raise core.AppError("활성 임직원 계정을 찾을 수 없습니다.", 404)
    return user


def _default_partner_user_id(user):
    # Keep this aligned with the existing PLAUD transcription workflow whenever possible.
    candidate = str(user.get("email") or user.get("username") or "").strip()
    if len(candidate) >= 6:
        return candidate[:255]
    username = re.sub(r"[^A-Za-z0-9._-]", "", str(user.get("username") or "user"))
    return f"MPK-{username}"[:255]


def _partner_user_id(value, user):
    candidate = _clean_text(value, 255) or _default_partner_user_id(user)
    if len(candidate) < 6:
        raise core.AppError("Partner User ID는 6자 이상이어야 합니다.")
    # One portal user should keep one stable PLAUD partner user id across devices.
    if core.DB_ENABLED:
        existing = core.fetchone(
            """SELECT partner_user_id FROM plaud_device_registry
               WHERE assigned_user_id=%s AND active=true ORDER BY created_at ASC LIMIT 1""",
            (str(user["id"]),),
        )
        if existing and existing.get("partner_user_id") != candidate:
            raise core.AppError(
                f"이 임직원은 이미 Partner User ID '{existing['partner_user_id']}'를 사용 중입니다. 동일한 ID를 사용해 주세요.",
                409,
            )
    return candidate


def _public(row):
    if not row:
        return None
    history = row.get("cloud_bind_history") or []
    if isinstance(history, str):
        try:
            history = json.loads(history)
        except ValueError:
            history = []
    return {
        "id": str(row.get("id")),
        "serial_number": row.get("serial_number") or "",
        "device_name": row.get("device_name") or "",
        "model": row.get("model") or "",
        "device_type": row.get("device_type") or "",
        "assigned_user_id": str(row.get("assigned_user_id") or ""),
        "assigned_user_name": row.get("assigned_user_name") or "",
        "assigned_username": row.get("assigned_username") or "",
        "partner_user_id": row.get("partner_user_id") or "",
        "bind_status": row.get("bind_status") or "registered",
        "ble_status": row.get("ble_status") or "not_connected",
        "firmware_version": row.get("firmware_version") or "",
        "last_seen_at": core.iso(row.get("last_seen_at")),
        "bound_at": core.iso(row.get("bound_at")),
        "unbound_at": core.iso(row.get("unbound_at")),
        "cloud_is_bind": row.get("cloud_is_bind"),
        "cloud_bind_history": history,
        "last_cloud_check_at": core.iso(row.get("last_cloud_check_at")),
        "last_error": row.get("last_error") or "",
        "active": bool(row.get("active", True)),
        "created_at": core.iso(row.get("created_at")),
        "updated_at": core.iso(row.get("updated_at")),
    }


def _find(device_id):
    value = str(device_id)
    if core.DB_ENABLED:
        return core.fetchone(
            """SELECT d.*, u.name AS assigned_user_name, u.username AS assigned_username
               FROM plaud_device_registry d
               LEFT JOIN users u ON u.id=d.assigned_user_id
               WHERE d.id=%s LIMIT 1""",
            (value,),
        )
    row = _memory_devices.get(value)
    if not row:
        return None
    user = core.find_user_by_id(row.get("assigned_user_id")) or {}
    return {**row, "assigned_user_name": user.get("name"), "assigned_username": user.get("username")}


def _list_users():
    if core.DB_ENABLED:
        rows = core.fetchall(
            """SELECT id::text,username,name,email,department
               FROM users WHERE status='active' ORDER BY name,username"""
        )
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
    for row in rows:
        row["suggested_partner_user_id"] = _default_partner_user_id(row)
    return rows


def list_devices(actor):
    if core.DB_ENABLED:
        rows = core.fetchall(
            """SELECT d.*, u.name AS assigned_user_name, u.username AS assigned_username
               FROM plaud_device_registry d
               LEFT JOIN users u ON u.id=d.assigned_user_id
               WHERE d.active=true
               ORDER BY d.updated_at DESC, d.created_at DESC"""
        )
    else:
        rows = [_find(key) for key in _memory_devices]
    return {
        "items": [_public(row) for row in rows if row],
        "users": _list_users(),
        "can_manage": actor.get("role") == "admin",
        "plaud_configured": plaud.configured(),
        "cloud_bind_available": plaud.configured(),
    }


def create_device(data, actor, ip):
    serial = _serial(data.get("serial_number"))
    dtype = _device_type(serial, data.get("device_type"))
    assigned_user = _active_user(data.get("assigned_user_id"))
    partner_id = _partner_user_id(data.get("partner_user_id"), assigned_user)
    name = _clean_text(data.get("device_name"), 120) or f"PLAUD {serial[-6:]}"
    model = _clean_text(data.get("model"), 80) or ("PLAUD Note Pro" if dtype == "notepro" else "PLAUD NotePin")
    device_id = str(uuid.uuid4())
    now = _now()
    if core.DB_ENABLED:
        try:
            row = core.execute(
                """INSERT INTO plaud_device_registry(
                     id,serial_number,device_name,model,device_type,assigned_user_id,
                     partner_user_id,bind_status,ble_status,registered_by
                   ) VALUES(%s,%s,%s,%s,%s,%s,%s,'registered','not_connected',%s)
                   RETURNING *""",
                (
                    device_id, serial, name, model, dtype, str(assigned_user["id"]),
                    partner_id, str(actor["id"]),
                ),
            )
        except Exception as exc:
            if getattr(exc, "pgcode", None) == "23505":
                raise core.AppError("이미 등록된 Serial Number입니다.", 409) from exc
            raise
    else:
        if any(row.get("serial_number") == serial for row in _memory_devices.values()):
            raise core.AppError("이미 등록된 Serial Number입니다.", 409)
        row = {
            "id": device_id, "serial_number": serial, "device_name": name,
            "model": model, "device_type": dtype, "assigned_user_id": str(assigned_user["id"]),
            "partner_user_id": partner_id, "bind_status": "registered",
            "ble_status": "not_connected", "cloud_is_bind": None,
            "cloud_bind_history": [], "active": True, "registered_by": str(actor["id"]),
            "created_at": now, "updated_at": now,
        }
        _memory_devices[device_id] = row
    core.write_audit(
        actor["id"], "plaud.device.register", "plaud_device", device_id,
        {"serial_number": serial, "device_type": dtype, "assigned_user_id": str(assigned_user["id"])}, ip,
    )
    return _public(_find(device_id))


def _cloud_binding_info(row):
    token = plaud._user_token(row["partner_user_id"])
    result = plaud._http_json(
        "GET",
        f"/developer/api/open/partner/sdk/binding?type={row['device_type']}&sn={row['serial_number']}",
        headers={"Authorization": f"Bearer {token}"},
        stage="PLAUD 기기 Bind 상태 확인",
    )
    is_bind = result.get("is_bind")
    history = result.get("bind_history") or []
    return is_bind, history


def refresh_cloud_status(device_id, actor, ip=None):
    row = _find(device_id)
    if not row or not row.get("active"):
        raise core.AppError("등록된 PLAUD 기기를 찾을 수 없습니다.", 404)
    plaud._require_configured()
    try:
        is_bind, history = _cloud_binding_info(row)
        status = "bound" if is_bind is True else ("unbound" if is_bind is False else "registered")
        if core.DB_ENABLED:
            core.execute(
                """UPDATE plaud_device_registry
                   SET cloud_is_bind=%s,cloud_bind_history=%s::jsonb,last_cloud_check_at=now(),
                       bind_status=%s,last_error=NULL,updated_at=now()
                   WHERE id=%s RETURNING id""",
                (is_bind, json.dumps(history, ensure_ascii=False), status, str(device_id)),
            )
        else:
            _memory_devices[str(device_id)].update({
                "cloud_is_bind": is_bind, "cloud_bind_history": history,
                "last_cloud_check_at": _now(), "bind_status": status,
                "last_error": None, "updated_at": _now(),
            })
        if ip:
            core.write_audit(actor["id"], "plaud.device.status_check", "plaud_device", str(device_id), {"is_bind": is_bind}, ip)
    except core.AppError as exc:
        if core.DB_ENABLED:
            core.execute(
                "UPDATE plaud_device_registry SET last_error=%s,last_cloud_check_at=now(),updated_at=now() WHERE id=%s RETURNING id",
                (str(exc), str(device_id)),
            )
        raise
    return _public(_find(device_id))


def cloud_bind(device_id, actor, ip):
    row = _find(device_id)
    if not row or not row.get("active"):
        raise core.AppError("등록된 PLAUD 기기를 찾을 수 없습니다.", 404)
    plaud._require_configured()
    token = plaud._user_token(row["partner_user_id"])
    try:
        plaud._http_json(
            "POST",
            "/developer/api/open/partner/sdk/bind",
            headers={"Authorization": f"Bearer {token}"},
            payload={"type": row["device_type"], "sn": row["serial_number"]},
            stage="PLAUD Cloud Device Bind",
        )
    except core.AppError as exc:
        if core.DB_ENABLED:
            core.execute(
                """UPDATE plaud_device_registry SET bind_status='bind_failed',last_error=%s,
                   last_cloud_check_at=now(),updated_at=now() WHERE id=%s RETURNING id""",
                (str(exc), str(device_id)),
            )
        else:
            _memory_devices[str(device_id)].update({"bind_status": "bind_failed", "last_error": str(exc), "updated_at": _now()})
        raise
    if core.DB_ENABLED:
        core.execute(
            """UPDATE plaud_device_registry SET bind_status='bound',cloud_is_bind=true,
               bound_at=now(),unbound_at=NULL,last_cloud_check_at=now(),last_error=NULL,updated_at=now()
               WHERE id=%s RETURNING id""",
            (str(device_id),),
        )
    else:
        _memory_devices[str(device_id)].update({
            "bind_status": "bound", "cloud_is_bind": True, "bound_at": _now(),
            "unbound_at": None, "last_cloud_check_at": _now(), "last_error": None, "updated_at": _now(),
        })
    core.write_audit(actor["id"], "plaud.device.cloud_bind", "plaud_device", str(device_id), {"serial_number": row["serial_number"]}, ip)
    return _public(_find(device_id))


def cloud_unbind(device_id, actor, ip):
    row = _find(device_id)
    if not row or not row.get("active"):
        raise core.AppError("등록된 PLAUD 기기를 찾을 수 없습니다.", 404)
    plaud._require_configured()
    token = plaud._user_token(row["partner_user_id"])
    plaud._http_json(
        "POST",
        "/developer/api/open/partner/sdk/unbind",
        headers={"Authorization": f"Bearer {token}"},
        payload={"type": row["device_type"], "sn": row["serial_number"]},
        stage="PLAUD Cloud Device Unbind",
    )
    if core.DB_ENABLED:
        core.execute(
            """UPDATE plaud_device_registry SET bind_status='unbound',cloud_is_bind=false,
               unbound_at=now(),last_cloud_check_at=now(),last_error=NULL,updated_at=now()
               WHERE id=%s RETURNING id""",
            (str(device_id),),
        )
    else:
        _memory_devices[str(device_id)].update({
            "bind_status": "unbound", "cloud_is_bind": False, "unbound_at": _now(),
            "last_cloud_check_at": _now(), "last_error": None, "updated_at": _now(),
        })
    core.write_audit(actor["id"], "plaud.device.cloud_unbind", "plaud_device", str(device_id), {"serial_number": row["serial_number"]}, ip)
    return _public(_find(device_id))


def update_device(device_id, data, actor, ip):
    row = _find(device_id)
    if not row or not row.get("active"):
        raise core.AppError("등록된 PLAUD 기기를 찾을 수 없습니다.", 404)
    if row.get("bind_status") == "bound" and any(key in data for key in ("assigned_user_id", "partner_user_id", "serial_number", "device_type")):
        raise core.AppError("PLAUD에 바인딩된 기기는 사용자/식별정보를 변경할 수 없습니다. 먼저 Cloud Unbind를 진행해 주세요.", 409)
    name = _clean_text(data.get("device_name", row.get("device_name")), 120) or row.get("device_name")
    model = _clean_text(data.get("model", row.get("model")), 80)
    if "assigned_user_id" in data:
        assigned = _active_user(data.get("assigned_user_id"))
        partner_id = _partner_user_id(data.get("partner_user_id"), assigned)
        assigned_user_id = str(assigned["id"])
    else:
        assigned_user_id = str(row.get("assigned_user_id") or "")
        partner_id = row.get("partner_user_id")
    if core.DB_ENABLED:
        core.execute(
            """UPDATE plaud_device_registry SET device_name=%s,model=%s,assigned_user_id=%s,
               partner_user_id=%s,updated_at=now() WHERE id=%s RETURNING id""",
            (name, model, assigned_user_id or None, partner_id, str(device_id)),
        )
    else:
        _memory_devices[str(device_id)].update({
            "device_name": name, "model": model, "assigned_user_id": assigned_user_id,
            "partner_user_id": partner_id, "updated_at": _now(),
        })
    core.write_audit(actor["id"], "plaud.device.update", "plaud_device", str(device_id), {}, ip)
    return _public(_find(device_id))


def archive_device(device_id, actor, ip):
    row = _find(device_id)
    if not row or not row.get("active"):
        raise core.AppError("등록된 PLAUD 기기를 찾을 수 없습니다.", 404)
    if row.get("cloud_is_bind") is True or row.get("bind_status") == "bound":
        raise core.AppError("바인딩된 기기는 삭제할 수 없습니다. 먼저 PLAUD Cloud Unbind를 진행해 주세요.", 409)
    if core.DB_ENABLED:
        core.execute(
            "UPDATE plaud_device_registry SET active=false,updated_at=now() WHERE id=%s RETURNING id",
            (str(device_id),),
        )
    else:
        _memory_devices[str(device_id)]["active"] = False
    core.write_audit(actor["id"], "plaud.device.archive", "plaud_device", str(device_id), {"serial_number": row["serial_number"]}, ip)
    return {"success": True, "device_id": str(device_id)}


def partner_user_for_portal_user(user):
    if not user:
        return None
    user_id = str(user.get("id") if isinstance(user, dict) else user)
    try:
        _ensure_schema()
    except Exception:
        return None
    if core.DB_ENABLED:
        row = core.fetchone(
            """SELECT partner_user_id FROM plaud_device_registry
               WHERE assigned_user_id=%s AND active=true
               ORDER BY CASE WHEN bind_status='bound' THEN 0 ELSE 1 END, created_at ASC LIMIT 1""",
            (user_id,),
        )
        return row.get("partner_user_id") if row else None
    for row in _memory_devices.values():
        if row.get("active") and str(row.get("assigned_user_id")) == user_id:
            return row.get("partner_user_id")
    return None


def install(app):
    def response(data, status=200):
        resp = jsonify(data)
        resp.status_code = status
        resp.headers["Cache-Control"] = "no-store"
        return resp

    def client_ip():
        return (request.headers.get("X-Forwarded-For") or request.remote_addr or "").split(",")[0].strip()

    def api_list():
        actor = _actor(False)
        return response(list_devices(actor))

    def api_create():
        actor = _actor(True)
        return response({"device": create_device(request.get_json(silent=True) or {}, actor, client_ip())}, 201)

    def api_update(device_id):
        actor = _actor(True)
        return response({"device": update_device(str(device_id), request.get_json(silent=True) or {}, actor, client_ip())})

    def api_bind(device_id):
        actor = _actor(True)
        return response({"device": cloud_bind(str(device_id), actor, client_ip()), "message": "PLAUD Cloud Bind가 완료되었습니다. Android 앱에서 BLE Bind/Handshake를 이어서 진행해 주세요."})

    def api_unbind(device_id):
        actor = _actor(True)
        return response({"device": cloud_unbind(str(device_id), actor, client_ip()), "message": "PLAUD Cloud Unbind가 완료되었습니다. 기기가 연결 가능한 경우 Android 앱에서도 depair를 진행해 주세요."})

    def api_status(device_id):
        actor = _actor(False)
        return response({"device": refresh_cloud_status(str(device_id), actor, client_ip())})

    def api_delete(device_id):
        actor = _actor(True)
        return response(archive_device(str(device_id), actor, client_ip()))

    app.add_url_rule("/api/plaud-devices", "plaud_devices_list", api_list, methods=["GET"])
    app.add_url_rule("/api/plaud-devices", "plaud_devices_create", api_create, methods=["POST"])
    app.add_url_rule("/api/plaud-devices/<uuid:device_id>", "plaud_devices_update", api_update, methods=["PATCH"])
    app.add_url_rule("/api/plaud-devices/<uuid:device_id>", "plaud_devices_delete", api_delete, methods=["DELETE"])
    app.add_url_rule("/api/plaud-devices/<uuid:device_id>/bind", "plaud_devices_bind", api_bind, methods=["POST"])
    app.add_url_rule("/api/plaud-devices/<uuid:device_id>/unbind", "plaud_devices_unbind", api_unbind, methods=["POST"])
    app.add_url_rule("/api/plaud-devices/<uuid:device_id>/status", "plaud_devices_status", api_status, methods=["POST"])
