"""Token-protected, one-time logical restore of the MedPark One public schema.

Only the fixed tables and columns below can be written.  The endpoint is disabled
unless ``AR_MIGRATION_TOKEN`` exists and is at least 32 characters long.
"""
import hashlib
import hmac
import json
import os
from datetime import date, datetime, timezone

import portal_core as core


TABLES = {
    "users": {
        "columns": ["id", "username", "email", "password_hash", "name", "employee_no", "department", "status", "role", "terminated_at", "password_changed_at", "created_at", "updated_at"],
        "key": ["id"],
    },
    "portal_app_migrations": {"columns": ["id", "applied_at"], "key": ["id"]},
    "portal_menu_labels": {"columns": ["menu_id", "label", "updated_by", "updated_at"], "key": ["menu_id"]},
    "portal_menu_order": {"columns": ["menu_id", "parent_id", "item_order", "updated_by", "updated_at"], "key": ["menu_id"]},
    "portal_custom_menu_items": {
        "columns": ["id", "parent_id", "label", "icon", "url", "item_order", "created_by", "created_at", "updated_at"],
        "key": ["id"],
    },
    "calendar_integration_settings": {
        "columns": ["id", "mode", "calendar_id", "api_key_encrypted", "oauth_client_id", "oauth_client_secret_encrypted", "access_token_encrypted", "refresh_token_encrypted", "token_expiry", "oauth_state_hash", "oauth_state_expiry", "updated_by", "updated_at"],
        "key": ["id"],
    },
    "calendar_integration_calendars": {
        "columns": ["calendar_id", "summary", "background_color", "primary_calendar", "access_role", "item_order", "updated_by", "updated_at", "foreground_color"],
        "key": ["calendar_id"],
    },
    "user_quick_links": {"columns": ["user_id", "system_id", "position", "updated_at"], "key": ["user_id", "system_id"]},
    "audit_logs": {
        "columns": ["id", "actor_user_id", "action", "target_type", "target_id", "metadata", "ip_address", "created_at"],
        "key": ["id"],
    },
    "portal_sessions": {"columns": ["token_hash", "user_id", "expires_at", "created_at"], "key": ["token_hash"]},
}

INSERT_ORDER = list(TABLES)
DELETE_ORDER = [
    "portal_sessions", "user_quick_links", "calendar_integration_calendars",
    "calendar_integration_settings", "portal_custom_menu_items", "portal_menu_order",
    "portal_menu_labels", "audit_logs", "portal_app_migrations", "users",
]


class MigrationError(Exception):
    pass


def migration_enabled():
    return len(os.environ.get("AR_MIGRATION_TOKEN", "")) >= 32


def authorize(value):
    expected = os.environ.get("AR_MIGRATION_TOKEN", "")
    supplied = str(value or "")
    if supplied.lower().startswith("bearer "):
        supplied = supplied[7:].strip()
    return migration_enabled() and hmac.compare_digest(supplied, expected)


def _ident(value):
    if value not in TABLES and not any(value in spec["columns"] for spec in TABLES.values()):
        raise MigrationError("허용되지 않은 SQL 식별자입니다.")
    return '"' + value.replace('"', '""') + '"'


def _canonical_value(value):
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return str(value)


def canonical_rows(rows, columns, keys):
    normalized = [[_canonical_value(row.get(column)) for column in columns] for row in rows]
    indexes = [columns.index(column) for column in keys]
    normalized.sort(key=lambda row: tuple("" if row[index] is None else str(row[index]) for index in indexes))
    encoded = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_snapshot(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("version") != "space7-portal-v1":
        raise MigrationError("지원하지 않는 포털 복원 스냅샷 형식입니다.")
    payload_tables = snapshot.get("tables")
    if not isinstance(payload_tables, dict) or set(payload_tables) != set(TABLES):
        raise MigrationError("포털 복원 테이블 구성이 고정 명세와 일치하지 않습니다.")
    for table, spec in TABLES.items():
        payload = payload_tables.get(table) or {}
        columns, rows = payload.get("columns"), payload.get("rows")
        if columns != spec["columns"] or not isinstance(rows, list):
            raise MigrationError(f"{table} 열 구성이 일치하지 않습니다.")
        if int(payload.get("row_count", -1)) != len(rows):
            raise MigrationError(f"{table} 행 수가 스냅샷 명세와 다릅니다.")
        for row in rows:
            if not isinstance(row, dict) or set(row) != set(columns):
                raise MigrationError(f"{table} 행 구조가 올바르지 않습니다.")
        digest = canonical_rows(rows, columns, spec["key"])
        if not hmac.compare_digest(str(payload.get("sha256") or ""), digest):
            raise MigrationError(f"{table} SHA-256이 일치하지 않습니다.")
    if payload_tables["portal_sessions"]["row_count"] != 0:
        raise MigrationError("보안을 위해 기존 로그인 세션은 복원할 수 없습니다.")
    return payload_tables


def _database_state(conn):
    state = {}
    with conn.cursor(cursor_factory=core.psycopg2.extras.RealDictCursor) as cur:
        for table, spec in TABLES.items():
            columns = spec["columns"]
            cur.execute("SELECT " + ",".join(_ident(column) for column in columns) + " FROM " + _ident(table))
            rows = [dict(row) for row in cur.fetchall()]
            state[table] = {"row_count": len(rows), "sha256": canonical_rows(rows, columns, spec["key"])}
    return state


def import_snapshot(snapshot):
    if not core.DB_ENABLED:
        raise MigrationError("PostgreSQL 연결이 필요합니다.")
    tables = validate_snapshot(snapshot)
    with core.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout = '5s'")
            cur.execute("SET LOCAL statement_timeout = '60s'")
            cur.execute("SELECT pg_try_advisory_xact_lock(%s)", (778110,))
            if not cur.fetchone()[0]:
                raise MigrationError("다른 포털 복원 작업이 진행 중입니다. 현재 상태를 먼저 확인해 주세요.")
            for table in DELETE_ORDER:
                cur.execute("DELETE FROM " + _ident(table))
            for table in INSERT_ORDER:
                spec, rows = TABLES[table], tables[table]["rows"]
                if not rows:
                    continue
                columns = spec["columns"]
                placeholders = ",".join(["%s"] * len(columns))
                sql = "INSERT INTO " + _ident(table) + " (" + ",".join(_ident(column) for column in columns) + ") VALUES (" + placeholders + ")"
                cur.executemany(sql, [tuple(row[column] for column in columns) for row in rows])
            cur.execute("SELECT setval(pg_get_serial_sequence('public.audit_logs','id'), COALESCE(MAX(id),1), COUNT(*) > 0) FROM public.audit_logs")
        state = _database_state(conn)
        for table in TABLES:
            expected, actual = tables[table], state[table]
            if expected["row_count"] != actual["row_count"] or not hmac.compare_digest(expected["sha256"], actual["sha256"]):
                raise MigrationError(f"{table} 복원 후 무결성 검증에 실패했습니다.")
    return {"source_dump_sha256": snapshot.get("source_dump_sha256"), "tables": state, "verified": True, "sessions_invalidated": True}


def database_state():
    if not core.DB_ENABLED:
        raise MigrationError("PostgreSQL 연결이 필요합니다.")
    with core.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout = '5s'")
            cur.execute("SET LOCAL statement_timeout = '30s'")
        return _database_state(conn)
