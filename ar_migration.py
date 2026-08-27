"""One-time, token-protected import of a verified space5 snapshot into schema ``ar``.

The endpoint that calls this module is disabled unless AR_MIGRATION_TOKEN exists.
Only the fixed receivables tables/columns below can be written.  The portal's
public schema is never referenced by this module.
"""
import hashlib
import hmac
import json
import os

from ar_module import db


TABLES = {
    "audit": {
        "columns": ["id", "actor", "action", "detail", "created_at"],
        "key": ["id"],
    },
    "collections": {
        "columns": ["id", "customer_code", "customer_name", "amount", "method", "paid_at", "state", "registered_by", "approved_by", "approved_at", "reject_reason", "note", "created_at"],
        "key": ["id"],
    },
    "customers": {
        "columns": ["code", "name", "biz_unit", "status", "owner", "balance", "normal_balance", "overdue_balance", "bad_balance", "advance", "overdue_days", "last_paid_at", "period", "source_month", "note", "updated_at", "normal_later_balance", "normal_next_balance", "normal_current_balance", "normal_collected", "overdue_source_balance", "overdue_collected", "collection_target_date"],
        "key": ["code"],
    },
    "kv": {"columns": ["scope", "key", "value"], "key": ["scope", "key"]},
    "month_locks": {"columns": ["month", "locked", "locked_by", "locked_at"], "key": ["month"]},
    "monthly_shipment_units": {
        "columns": ["month", "code", "name", "biz_unit", "owner", "collection_period", "target_month", "bucket", "amount", "balance", "note", "uploaded_at"],
        "key": ["month", "code", "biz_unit"],
    },
    "monthly_shipments": {
        "columns": ["month", "code", "name", "biz_unit", "owner", "collection_period", "target_month", "bucket", "amount", "balance", "note", "uploaded_at"],
        "key": ["month", "code"],
    },
    "receivable_items": {
        "columns": ["id", "customer_code", "source_key", "issue_month", "target_month", "category", "original_amount", "balance", "target_date", "note", "created_at", "biz_unit"],
        "key": ["id"],
    },
    "targets": {
        "columns": ["id", "customer_code", "customer_name", "amount", "target_date", "done_date", "method", "assignee", "state", "note", "created_by", "created_at"],
        "key": ["id"],
    },
    "uploads": {
        "columns": ["id", "month", "filename", "row_count", "uploaded_by", "uploaded_at", "replaced", "upload_type", "shipment_date"],
        "key": ["id"],
    },
    "users": {
        "columns": ["username", "name", "title", "role", "biz_unit", "password", "permissions", "active", "created_at"],
        "key": ["username"],
    },
}

SEQUENCE_TABLES = ("audit", "collections", "receivable_items", "targets", "uploads")


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


def _sort_value(value):
    return "" if value is None else str(value)


def canonical_rows(rows, columns, keys):
    normalized = [[row.get(column) for column in columns] for row in rows]
    indexes = [columns.index(column) for column in keys]
    normalized.sort(key=lambda row: tuple(_sort_value(row[index]) for index in indexes))
    encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_snapshot(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("version") != "space5-ar-v1":
        raise MigrationError("지원하지 않는 이관 스냅샷 형식입니다.")
    payload_tables = snapshot.get("tables")
    if not isinstance(payload_tables, dict) or set(payload_tables) != set(TABLES):
        raise MigrationError("이관 테이블 구성이 고정 명세와 일치하지 않습니다.")
    for table, spec in TABLES.items():
        payload = payload_tables.get(table) or {}
        columns = payload.get("columns")
        rows = payload.get("rows")
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
    return payload_tables


def _database_state(conn):
    state = {}
    for table, spec in TABLES.items():
        columns = spec["columns"]
        rows = conn.execute("SELECT " + ",".join(columns) + " FROM " + table).fetchall()
        state[table] = {
            "row_count": len(rows),
            "sha256": canonical_rows(rows, columns, spec["key"]),
        }
    return state


def import_snapshot(snapshot):
    tables = validate_snapshot(snapshot)
    with db.connect() as conn:
        if db.USE_PG:
            conn.execute("SELECT pg_advisory_xact_lock(%s)", (778109,))
        for table in reversed(list(TABLES)):
            conn.execute("DELETE FROM " + table)
        for table, spec in TABLES.items():
            columns = spec["columns"]
            rows = tables[table]["rows"]
            if rows:
                placeholders = ",".join(["%s"] * len(columns))
                sql = "INSERT INTO " + table + " (" + ",".join(columns) + ") VALUES (" + placeholders + ")"
                conn.executemany(sql, [tuple(row[column] for column in columns) for row in rows])
        if db.USE_PG:
            for table in SEQUENCE_TABLES:
                conn.execute(
                    "SELECT setval(pg_get_serial_sequence(%s,'id'), COALESCE(MAX(id),1), COUNT(*) > 0) FROM " + table,
                    ("ar." + table,),
                )
        state = _database_state(conn)
        for table in TABLES:
            expected = tables[table]
            actual = state[table]
            if expected["row_count"] != actual["row_count"] or not hmac.compare_digest(expected["sha256"], actual["sha256"]):
                raise MigrationError(f"{table} 이관 후 무결성 검증에 실패했습니다.")
    return {
        "source_dump_sha256": snapshot.get("source_dump_sha256"),
        "tables": state,
        "verified": True,
    }


def database_state():
    with db.connect() as conn:
        return _database_state(conn)
