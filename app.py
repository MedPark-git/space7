import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, make_response, redirect, request, send_from_directory
from werkzeug.middleware.dispatcher import DispatcherMiddleware

import calendar_service as calendars
import portal_core as core
import ar_migration
import portal_migration

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"

core.init_database()

from ar_module.app import app as receivables_app  # schema exists before import

portal = Flask(__name__, static_folder=None)
portal.json.ensure_ascii = False
portal.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024


def payload():
    return request.get_json(silent=True) or {}


def request_ip():
    return (request.headers.get("X-Forwarded-For") or request.remote_addr or "").split(",")[0].strip()


def current_user(admin=False):
    user = core.get_session_user(request.cookies.get(core.SESSION_COOKIE))
    if not user:
        raise core.AppError("로그인이 필요합니다.", 401)
    if admin and user.get("role") != "admin":
        raise core.AppError("관리자 권한이 필요합니다.", 403)
    return user


def json_response(data, status=200):
    response = make_response(jsonify(data), status)
    response.headers["Cache-Control"] = "no-store"
    return response


@portal.errorhandler(core.AppError)
def handle_app_error(error):
    return json_response({"message": str(error)}, error.status)


@portal.errorhandler(Exception)
def handle_error(error):
    code = getattr(error, "pgcode", None)
    if code == "23505":
        return json_response({"message": "이미 사용 중인 계정 ID 또는 사번입니다."}, 409)
    if code == "23502":
        return json_response({"message": "필수 계정 정보를 모두 입력해 주세요."}, 400)
    portal.logger.exception("Request failed")
    return json_response({"message": "서버 처리 중 오류가 발생했습니다."}, 500)


@portal.get("/api/health")
def health():
    return jsonify(status="ok", database="postgresql" if core.DB_ENABLED else "memory", runtime="python-flask", receivables_mount="/tf/ar/")


@portal.post("/api/auth/login")
def login():
    data = payload()
    user = core.find_user_by_username(data.get("username"))
    if not user or user.get("status") != "active" or not core.verify_password(str(data.get("password") or ""), user.get("password_hash")):
        return json_response({"message": "계정 ID 또는 비밀번호를 확인해 주세요."}, 401)
    token = core.create_session(user["id"])
    core.write_audit(user["id"], "auth.login", "user", str(user["id"]), {}, request_ip())
    response = json_response({"user": core.public_user(user)})
    response.set_cookie(core.SESSION_COOKIE, token, max_age=int(core.SESSION_TTL.total_seconds()), httponly=True, secure=request.is_secure, samesite="Strict", path="/")
    return response


@portal.post("/api/auth/logout")
def logout():
    core.delete_session(request.cookies.get(core.SESSION_COOKIE))
    response = json_response({"success": True})
    response.delete_cookie(core.SESSION_COOKIE, path="/")
    return response


@portal.get("/api/auth/me")
def me():
    return json_response({"user": core.public_user(current_user())})


@portal.get("/api/menu")
def menu_get():
    current_user()
    return json_response(core.menu_config())


@portal.patch("/api/admin/menu")
def menu_patch():
    actor = current_user(True)
    return json_response(core.update_menu_labels(payload(), actor, request_ip()))


@portal.post("/api/admin/menu")
def menu_post():
    actor = current_user(True)
    return json_response(core.create_menu_item(payload(), actor, request_ip()), 201)


@portal.put("/api/admin/menu/order")
def menu_order():
    actor = current_user(True)
    return json_response(core.update_menu_order(payload(), actor, request_ip()))


@portal.get("/api/quick-links")
def quick_links_get():
    user = current_user()
    return json_response(core.get_quick_links(user["id"]))


@portal.put("/api/quick-links")
def quick_links_put():
    user = current_user()
    return json_response(core.update_quick_links(payload(), user, request_ip()))


@portal.get("/api/admin/users")
def users_get():
    current_user(True)
    return json_response({"users": core.list_users()})


@portal.post("/api/admin/users")
def users_post():
    actor = current_user(True)
    return json_response({"user": core.create_user(payload(), actor, request_ip())}, 201)


@portal.patch("/api/admin/users/<uuid:user_id>")
def users_patch(user_id):
    actor = current_user(True)
    return json_response({"user": core.update_user(str(user_id), payload(), actor, request_ip())})


@portal.get("/api/calendar/events")
def calendar_events():
    current_user()
    return json_response(calendars.calendar_events(request.args.get("month")))


@portal.get("/api/admin/calendar/settings")
def calendar_settings_get():
    current_user(True)
    return json_response(calendars.public_settings(calendars.settings_row()))


@portal.put("/api/admin/calendar/settings")
def calendar_settings_put():
    actor = current_user(True)
    return json_response(calendars.save_settings(payload(), actor, request_ip()))


@portal.get("/api/admin/calendar/calendars")
def calendar_list_get():
    current_user(True)
    return json_response(calendars.list_available())


@portal.put("/api/admin/calendar/calendars")
def calendar_list_put():
    actor = current_user(True)
    return json_response(calendars.save_selected(payload(), actor, request_ip()))


@portal.post("/api/admin/calendar/test")
def calendar_test():
    current_user(True)
    result = calendars.calendar_events(request.args.get("month"))
    count = result.get("calendar_count", 1)
    warnings = len(result.get("warnings") or [])
    message = result.get("message") or f"{count}개 캘린더에서 {len(result.get('events') or [])}개의 일정을 확인했습니다."
    if warnings:
        message += f" ({warnings}개 캘린더 조회 실패)"
    return json_response({"success": bool(result.get("connected")), "event_count": len(result.get("events") or []), "calendar_count": count, "warning_count": warnings, "message": message})


@portal.post("/api/admin/calendar/oauth/start")
def calendar_oauth_start():
    actor = current_user(True)
    return json_response(calendars.start_oauth(actor, request_ip()))


@portal.get("/api/calendar/oauth/callback")
def calendar_oauth_callback():
    if request.args.get("error"):
        return redirect("/?calendar=denied")
    calendars.exchange_code(request.args.get("code"), request.args.get("state"))
    return redirect("/?calendar=connected")


@portal.post("/api/webhooks/plaud")
def plaud_webhook():
    payload()
    return json_response({"accepted": True, "preview": True}, 202)


@portal.post("/api/admin/migrations/ar/import")
def ar_import():
    if not ar_migration.migration_enabled():
        return json_response({"message": "이관 경로가 비활성화되어 있습니다."}, 404)
    if not ar_migration.authorize(request.headers.get("Authorization")):
        return json_response({"message": "이관 인증에 실패했습니다."}, 401)
    try:
        result = ar_migration.import_snapshot(payload())
    except ar_migration.MigrationError as error:
        return json_response({"message": str(error)}, 422)
    return json_response(result)


@portal.post("/api/admin/migrations/portal/import")
def portal_import():
    if not portal_migration.migration_enabled():
        return json_response({"message": "이관 경로가 비활성화되어 있습니다."}, 404)
    if not portal_migration.authorize(request.headers.get("Authorization")):
        return json_response({"message": "이관 인증에 실패했습니다."}, 401)
    try:
        result = portal_migration.import_snapshot(payload())
    except portal_migration.MigrationError as error:
        return json_response({"message": str(error)}, 422)
    return json_response(result)


@portal.get("/api/admin/migrations/portal/status")
def portal_import_status():
    if not portal_migration.migration_enabled():
        return json_response({"message": "이관 경로가 비활성화되어 있습니다."}, 404)
    if not portal_migration.authorize(request.headers.get("Authorization")):
        return json_response({"message": "이관 인증에 실패했습니다."}, 401)
    return json_response({"tables": portal_migration.database_state()})


@portal.get("/api/admin/migrations/ar/status")
def ar_import_status():
    if not ar_migration.migration_enabled():
        return json_response({"message": "이관 경로가 비활성화되어 있습니다."}, 404)
    if not ar_migration.authorize(request.headers.get("Authorization")):
        return json_response({"message": "이관 인증에 실패했습니다."}, 401)
    return json_response({"tables": ar_migration.database_state()})


@portal.get("/")
def index():
    response = send_from_directory(PUBLIC, "index.html")
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


@portal.get("/<path:path>")
def public_file(path):
    candidate = (PUBLIC / path).resolve()
    if candidate.is_file() and str(candidate).startswith(str(PUBLIC.resolve())):
        response = send_from_directory(PUBLIC, path)
        response.headers["Cache-Control"] = "no-cache, max-age=0, must-revalidate"
        return response
    response = send_from_directory(PUBLIC, "index.html")
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


app = DispatcherMiddleware(portal, {"/tf/ar": receivables_app})


if __name__ == "__main__":
    from werkzeug.serving import run_simple
    run_simple("0.0.0.0", int(os.environ.get("PORT", "3000")), app)
