"""SSO registration preparation only; this module never authenticates users.

The inventory is versioned with the portal. Real OIDC endpoints and client
credentials are intentionally absent until the provider/client rollout.
"""
import copy
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from flask import jsonify

MANIFEST_PATH = Path(__file__).resolve().parent / "config" / "sso_spaces.json"
PORTAL_URL = "https://medprk-medpark-one.mycafe24.ai"
CLIENT_ID = re.compile(r"medpark-space-[0-9]{2,4}\Z")
PROJECT_ID = re.compile(r"medprk-[a-z0-9]+(?:-[a-z0-9]+)*\Z")
REQUIRED_POLICY = {
    "protocol": "openid_connect",
    "response_types": ["code"],
    "grant_types": ["authorization_code"],
    "pkce_method": "S256",
    "token_endpoint_auth_method": "client_secret_basic",
    "scopes": ["openid", "profile"],
    "identity_key": ["iss", "sub"],
    "account_linking": "administrator_verified",
    "automatic_account_creation": False,
    "role_source": "local_application",
    "share_session_cookies": False,
    "credentials_in_exports": False,
    "existing_login": "preserve_until_site_validation",
    "logout_target": "backchannel_with_session_revocation",
    "session_recheck_target_seconds": 60,
}
AUTH_LABELS = {
    "portal_session_user": "포털 임직원 계정",
    "flask_session_user": "사이트별 사용자 계정",
    "flask_login_user": "사이트별 사용자 계정",
    "shared_password": "공용 접속 비밀번호",
    "unverified": "현재 로그인 방식 확인 필요",
    "unassigned": "사이트 생성 대기",
}


def validate_manifest(data):
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise ValueError("지원하지 않는 SSO 설정 형식입니다.")
    if data.get("mode") != "preparation" or data.get("authentication_enabled") is not False:
        raise ValueError("사전 설정에서 실제 인증을 활성화할 수 없습니다.")
    if data.get("portal_url") != PORTAL_URL or data.get("planned_issuer") != PORTAL_URL + "/sso":
        raise ValueError("통합 인증 기준 주소를 확인해 주세요.")
    if data.get("excluded_integrations") != ["amaranth"]:
        raise ValueError("아마란스는 SSO 적용 대상에서 제외되어야 합니다.")
    if data.get("policy") != REQUIRED_POLICY:
        raise ValueError("SSO 연결 정책이 승인된 사전 설정과 다릅니다.")
    spaces = data.get("spaces")
    if not isinstance(spaces, list) or not spaces:
        raise ValueError("공간 목록이 필요합니다.")
    ids, labels, clients, projects, origins = set(), set(), set(), set(), set()
    portal_count = 0
    for item in spaces:
        if not isinstance(item, dict):
            raise ValueError("공간 설정 형식이 올바르지 않습니다.")
        sid, label, cid = item.get("space_id"), item.get("space_label"), item.get("client_id")
        if type(sid) is not int or sid < 1 or not isinstance(label, str) or not re.fullmatch(r"space_[0-9]{2,4}", label):
            raise ValueError("공간 식별자가 올바르지 않습니다.")
        if not isinstance(cid, str) or not CLIENT_ID.fullmatch(cid) or cid != "medpark-space-" + label.split("_")[1]:
            raise ValueError("사이트별 SSO 식별자가 올바르지 않습니다.")
        if sid in ids or label in labels or cid in clients:
            raise ValueError("공간 또는 SSO 식별자가 중복되었습니다.")
        ids.add(sid); labels.add(label); clients.add(cid)
        if item.get("included") is not True or item.get("enabled") is not False:
            raise ValueError("전체 공간을 비활성 준비 상태로 등록해야 합니다.")
        if item.get("kind") not in ("portal", "application") or item.get("auth_model") not in AUTH_LABELS:
            raise ValueError("사이트 유형을 확인해 주세요.")
        project, origin = item.get("project_id"), item.get("public_url")
        urls = ("callback_uri", "post_logout_redirect_uri", "backchannel_logout_uri")
        if project is None:
            if origin is not None or any(item.get(k) is not None for k in urls) or item.get("status") != "reserved" or item.get("kind") != "application" or item.get("auth_model") != "unassigned":
                raise ValueError("빈 공간에는 미확정 주소를 등록할 수 없습니다.")
            continue
        if not isinstance(project, str) or not PROJECT_ID.fullmatch(project):
            raise ValueError("현재 계정의 AI SPACE 프로젝트만 등록할 수 있습니다.")
        expected_origin = f"https://{project}.mycafe24.ai"
        if origin != expected_origin or project in projects or origin in origins or item.get("status") != "prepared":
            raise ValueError("프로젝트 주소가 일치하지 않거나 중복되었습니다.")
        parsed = urlsplit(origin)
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment:
            raise ValueError("정확한 HTTPS 사이트 주소가 필요합니다.")
        projects.add(project); origins.add(origin)
        expected_urls = (origin + "/auth/sso/callback", origin + "/", origin + "/auth/sso/backchannel-logout")
        if tuple(item.get(k) for k in urls) != expected_urls:
            raise ValueError("연결 주소는 해당 사이트의 정확한 등록 주소와 일치해야 합니다.")
        if item.get("kind") == "portal":
            portal_count += 1
            if project != "medprk-medpark-one" or item.get("auth_model") != "portal_session_user":
                raise ValueError("MedPark One만 통합 포털로 지정할 수 있습니다.")
    if portal_count != 1:
        raise ValueError("MedPark One 통합 포털이 하나 필요합니다.")
    return data


def load_manifest(path=MANIFEST_PATH):
    with Path(path).open(encoding="utf-8") as source:
        return validate_manifest(json.load(source))


def readiness(item):
    if not item["project_id"]:
        return ["사이트 생성 후 실제 주소 등록", "로그인 방식 및 사용자 권한 확인"]
    result = ["통합 인증 서버 구축·검증", "사이트 로그인 연동·개별 인증키 발급"]
    if item["auth_model"] == "unverified":
        result.append("운영 소스와 로그인 방식 확인")
    if item["auth_model"] == "shared_password":
        result.append("공용 비밀번호에서 임직원별 접속 식별·접근 권한 연동")
    elif item["kind"] != "portal":
        result.append("기존 사용자와 포털 임직원 연결 확인")
    result.extend(["사이트별 기존 권한·작성 이력 검증", "퇴사 차단·전체 로그아웃 검증", "운영 배포 및 실제 로그인 확인"])
    return result


def overview(data):
    data = validate_manifest(copy.deepcopy(data))
    items = data["spaces"]
    for item in items:
        item["auth_label"] = AUTH_LABELS[item["auth_model"]]
        item["remaining_tasks"] = readiness(item)
    data["summary"] = {
        "total_spaces": len(items),
        "occupied_spaces": sum(bool(i["project_id"]) for i in items),
        "reserved_spaces": sum(i["project_id"] is None for i in items),
        "active_sso_sites": 0,
    }
    return data


def client_profile(data, client_id):
    validate_manifest(data)
    item = next((i for i in data["spaces"] if i["client_id"] == client_id), None)
    if item is None:
        raise KeyError(client_id)
    if not item["project_id"]:
        raise ValueError("사이트가 생성된 후 연결 정보를 받을 수 있습니다.")
    return {
        "schema_version": 1,
        "mode": "preparation",
        "enabled": False,
        "space_id": item["space_id"],
        "space_label": item["space_label"],
        "project_id": item["project_id"],
        "planned_issuer": data["planned_issuer"],
        "oidc_client": {
            "client_id": item["client_id"],
            "client_name": item["display_name"],
            "application_type": "web",
            "redirect_uris": [item["callback_uri"]],
            "post_logout_redirect_uris": [item["post_logout_redirect_uri"]],
            "backchannel_logout_uri": item["backchannel_logout_uri"],
            "backchannel_logout_session_required": True,
            "response_types": ["code"],
            "grant_types": ["authorization_code"],
            "token_endpoint_auth_method": "client_secret_basic",
        },
        "client_requirements": copy.deepcopy(REQUIRED_POLICY),
        "remaining_tasks": readiness(item),
        "notice": "연결 준비용 설정입니다. 통합 인증 서버와 해당 사이트의 연동 구현·검증 후 사용할 수 있습니다. 인증키는 포함하지 않습니다.",
    }


def configuration_bundle(data):
    validate_manifest(data)
    return {
        "schema_version": 1,
        "mode": "preparation",
        "authentication_enabled": False,
        "inventory_checked_on": data["inventory_checked_on"],
        "excluded_integrations": ["amaranth"],
        "clients": [client_profile(data, i["client_id"]) for i in data["spaces"] if i["project_id"]],
        "reserved_spaces": [{k: i[k] for k in ("space_id", "space_label", "client_id")} for i in data["spaces"] if not i["project_id"]],
    }


def install(app, require_admin, manifest_path=MANIFEST_PATH):
    """Read-only configuration endpoints; no DB/schema/session mutation."""
    if "sso_preparation_overview" in app.view_functions:
        return

    def response(payload, status=200, filename=None):
        result = jsonify(payload)
        result.status_code = status
        result.headers["Cache-Control"] = "no-store, private"
        result.headers["X-Content-Type-Options"] = "nosniff"
        if filename:
            result.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        return result

    def read():
        require_admin(True)
        try:
            return load_manifest(manifest_path), None
        except (OSError, ValueError, TypeError, KeyError):
            app.logger.error("Invalid SSO preparation manifest")
            return None, response({"message": "SSO 사전 설정 파일을 확인해 주세요."}, 503)

    @app.get("/api/admin/sso/preparation")
    def sso_preparation_overview():
        data, error = read()
        return error if error is not None else response(overview(data))

    @app.get("/api/admin/sso/preparation/export")
    def sso_preparation_export():
        data, error = read()
        return error if error is not None else response(configuration_bundle(data), filename="medpark-sso-preparation.json")

    @app.get("/api/admin/sso/preparation/clients/<client_id>/config")
    def sso_preparation_client(client_id):
        data, error = read()
        if error is not None:
            return error
        try:
            profile = client_profile(data, client_id)
        except KeyError:
            return response({"message": "등록되지 않은 사이트입니다."}, 404)
        except ValueError as exc:
            return response({"message": str(exc)}, 409)
        return response(profile, filename=client_id + ".json")
