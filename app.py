import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, make_response, redirect, request, send_from_directory
from werkzeug.exceptions import HTTPException

import calendar_integration as calendar
import plaud_integration as plaud
import portal_core as core

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"

core.init_database()

portal = Flask(__name__, static_folder=None)
portal.json.ensure_ascii = False
portal.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024


def payload():
    return request.get_json(silent=True) or {}


def request_ip():
    return (request.headers.get("X-Forwarded-For") or request.remote_addr or "").split(",")[0].strip()


def calendar_redirect_uri():
    scheme = (request.headers.get("X-Forwarded-Proto") or request.scheme or "https").split(",")[0].strip().lower()
    host = (request.headers.get("X-Forwarded-Host") or request.host or "").split(",")[0].strip()
    if scheme not in ("http", "https"):
        scheme = "https"
    if not host or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:" for character in host):
        raise core.AppError("캘린더 OAuth 리디렉션 주소를 확인할 수 없습니다.", 503)
    return f"{scheme}://{host}/api/admin/calendar/oauth/callback"


def current_user(admin=False):
    core.ensure_database_ready()
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
    if isinstance(error, HTTPException):
        return json_response({"message": error.description}, error.code or 500)
    code = getattr(error, "pgcode", None)
    if code == "23505":
        return json_response({"message": "이미 사용 중인 계정 ID 또는 사번입니다."}, 409)
    if code == "23502":
        return json_response({"message": "필수 계정 정보를 모두 입력해 주세요."}, 400)
    portal.logger.exception("Request failed")
    return json_response({"message": "서버 처리 중 오류가 발생했습니다."}, 500)


@portal.get("/api/health")
def health():
    return jsonify(status="ok", runtime="python-flask", **core.database_status())


@portal.post("/api/auth/login")
def login():
    core.ensure_database_ready()
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


@portal.get("/api/meetings/plaud/config")
def plaud_config_get():
    current_user()
    return json_response(plaud.configuration_payload())


@portal.get("/api/meetings/plaud/stats")
def plaud_stats_get():
    current_user()
    return json_response(plaud.stats())


@portal.get("/api/meetings/plaud")
def plaud_meetings_get():
    actor = current_user()
    return json_response(plaud.list_meetings(
        actor,
        request.args.get("query", ""),
        request.args.get("status", ""),
        request.args.get("page", 1),
        request.args.get("page_size", 20),
    ))


@portal.get("/api/meetings/plaud/<uuid:meeting_id>")
def plaud_meeting_get(meeting_id):
    actor = current_user()
    return json_response({"meeting": plaud.get_meeting(str(meeting_id), actor)})


@portal.post("/api/meetings/plaud/uploads/start")
def plaud_upload_start():
    actor = current_user()
    return json_response(plaud.start_upload(payload(), actor))


@portal.post("/api/meetings/plaud/uploads/complete")
def plaud_upload_complete():
    actor = current_user()
    return json_response({"meeting": plaud.complete_upload(payload(), actor, request_ip())}, 201)


@portal.post("/api/meetings/plaud/sync")
def plaud_sync():
    current_user()
    return json_response(plaud.sync_meetings(5))


@portal.get("/api/admin/calendar/settings")
def calendar_settings_get():
    current_user(True)
    return json_response(calendar.settings_payload(calendar_redirect_uri()))


@portal.put("/api/admin/calendar/settings")
def calendar_settings_put():
    actor = current_user(True)
    return json_response(calendar.update_settings(payload(), actor, request_ip(), calendar_redirect_uri()))


@portal.post("/api/admin/calendar/test")
def calendar_test():
    current_user(True)
    return json_response(calendar.test_connection())


@portal.get("/api/admin/calendar/calendars")
def calendar_list_get():
    current_user(True)
    return json_response(calendar.list_calendars())


@portal.put("/api/admin/calendar/calendars")
def calendar_list_put():
    actor = current_user(True)
    return json_response(calendar.save_selected_calendars(payload(), actor, request_ip()))


@portal.post("/api/admin/calendar/oauth/start")
def calendar_oauth_start():
    actor = current_user(True)
    return json_response(calendar.start_oauth(actor, calendar_redirect_uri(), request_ip()))


@portal.get("/api/admin/calendar/oauth/callback")
def calendar_oauth_callback():
    result = calendar.finish_oauth(
        request.args.get("code"),
        request.args.get("state"),
        request.args.get("error"),
        request_ip(),
    )
    outcome = "connected" if result.get("connected") else "cancelled"
    return redirect(f"/?calendar={outcome}", code=302)


@portal.get("/api/calendar/events")
def calendar_events():
    current_user()
    return json_response(calendar.list_events(request.args.get("month")))


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


app = portal


if __name__ == "__main__":
    from werkzeug.serving import run_simple
    run_simple("0.0.0.0", int(os.environ.get("PORT", "3000")), app)
