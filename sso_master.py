"""MedPark One OpenID Connect master for AI SPACE applications."""

import base64
import copy
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import parse, request as urlrequest
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from flask import jsonify, make_response, redirect, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

import portal_core as core

MANIFEST_PATH = Path(__file__).resolve().parent / "config" / "sso_spaces.json"
PORTAL_URL = "https://medprk-medpark-one.mycafe24.ai"
ISSUER = PORTAL_URL + "/sso"
CLIENT_ID = re.compile(r"medpark-space-[0-9]{2,4}\Z")
PROJECT_ID = re.compile(r"medprk-[a-z0-9]+(?:-[a-z0-9]+)*\Z")
AUTHORIZATION_CODE_TTL = timedelta(minutes=2)
ACCESS_TOKEN_TTL = timedelta(hours=1)
ID_TOKEN_TTL = timedelta(minutes=5)
PENDING_TTL_SECONDS = 300
PENDING_COOKIE = "medpark_sso_pending"
PKCE_VERIFIER = re.compile(r"[A-Za-z0-9._~-]{43,128}\Z")
ALLOWED_SCOPES = {"openid", "profile", "email"}

_memory_lock = threading.Lock()
_memory_codes = {}
_memory_tokens = {}
_signing_cache = {"pem": None, "key": None, "jwk": None, "kid": None}


class OAuthError(Exception):
    def __init__(self, error, description, status=400, redirect_uri=None, state=None):
        super().__init__(description)
        self.error = error
        self.description = description
        self.status = status
        self.redirect_uri = redirect_uri
        self.state = state


def _b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_int(value):
    length = max(1, (value.bit_length() + 7) // 8)
    return _b64url(value.to_bytes(length, "big"))


def _utcnow():
    return datetime.now(timezone.utc)


def _is_secure_request():
    forwarded = (request.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip().lower()
    return request.is_secure or forwarded == "https"


def _secret_env_name(space_label):
    return "SSO_CLIENT_SECRET_" + space_label.upper()


def _exact_site_urls(project_id):
    origin = f"https://{project_id}.mycafe24.ai"
    return {
        "public_url": origin,
        "callback_uri": origin + "/auth/sso/callback",
        "post_logout_redirect_uri": origin + "/",
        "backchannel_logout_uri": origin + "/auth/sso/backchannel-logout",
    }


def validate_manifest(data):
    if not isinstance(data, dict) or data.get("schema_version") != 2:
        raise ValueError("지원하지 않는 SSO 설정 형식입니다.")
    if data.get("mode") != "master" or data.get("authentication_enabled") is not True:
        raise ValueError("MedPark One 중앙 인증 설정이 활성화되어야 합니다.")
    if data.get("portal_url") != PORTAL_URL or data.get("issuer") != ISSUER:
        raise ValueError("통합 인증 기준 주소를 확인해 주세요.")
    if data.get("excluded_integrations") != ["amaranth"]:
        raise ValueError("아마란스는 SSO 적용 대상에서 제외되어야 합니다.")
    policy = data.get("policy") or {}
    required = {
        "protocol": "openid_connect",
        "response_types": ["code"],
        "grant_types": ["authorization_code"],
        "pkce_method": "S256",
        "identity_key": ["iss", "sub"],
        "account_linking": "administrator_verified",
        "automatic_account_creation": False,
        "role_source": "local_application",
        "share_session_cookies": False,
    }
    if any(policy.get(key) != value for key, value in required.items()):
        raise ValueError("SSO 보안 정책이 승인된 중앙 인증 규칙과 다릅니다.")

    spaces = data.get("spaces")
    if not isinstance(spaces, list) or not spaces:
        raise ValueError("공간 목록이 필요합니다.")
    ids, labels, clients, projects, origins = set(), set(), set(), set(), set()
    portal_count = 0
    for item in spaces:
        if not isinstance(item, dict):
            raise ValueError("공간 설정 형식이 올바르지 않습니다.")
        sid, label, client_id = item.get("space_id"), item.get("space_label"), item.get("client_id")
        if type(sid) is not int or sid < 1 or not isinstance(label, str) or not re.fullmatch(r"space_[0-9]{2,4}", label):
            raise ValueError("공간 식별자가 올바르지 않습니다.")
        expected_client = "medpark-space-" + label.split("_")[1]
        if not isinstance(client_id, str) or not CLIENT_ID.fullmatch(client_id) or client_id != expected_client:
            raise ValueError("사이트별 SSO 식별자가 올바르지 않습니다.")
        if sid in ids or label in labels or client_id in clients:
            raise ValueError("공간 또는 SSO 식별자가 중복되었습니다.")
        ids.add(sid); labels.add(label); clients.add(client_id)
        if item.get("included") is not True or item.get("kind") not in ("portal", "application"):
            raise ValueError("공간 적용 범위를 확인해 주세요.")

        project = item.get("project_id")
        if project is None:
            if item.get("status") != "reserved" or item.get("enabled") is not False or item.get("kind") != "application":
                raise ValueError("빈 공간은 비활성 예약 상태여야 합니다.")
            continue
        if not isinstance(project, str) or not PROJECT_ID.fullmatch(project) or project in projects:
            raise ValueError("현재 계정의 AI SPACE 프로젝트만 한 번씩 등록할 수 있습니다.")
        projects.add(project)
        origin = _exact_site_urls(project)["public_url"]
        if origin in origins:
            raise ValueError("프로젝트 주소가 중복되었습니다.")
        origins.add(origin)
        parsed = urlsplit(origin)
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment:
            raise ValueError("정확한 HTTPS 사이트 주소가 필요합니다.")

        if item.get("kind") == "portal":
            portal_count += 1
            if project != "medprk-medpark-one" or item.get("status") != "master" or item.get("enabled") is not True:
                raise ValueError("MedPark One만 통합 인증 마스터로 지정할 수 있습니다.")
            continue
        if item.get("status") != "registered" or item.get("enabled") is not True:
            raise ValueError("운영 중인 하위 공간은 연결 등록 상태여야 합니다.")
        application_type = item.get("application_type")
        if application_type not in ("web", "browser"):
            raise ValueError("하위 공간의 애플리케이션 유형을 확인해 주세요.")
        expected_method = "none" if application_type == "browser" else "client_secret_basic"
        if item.get("token_endpoint_auth_method") != expected_method:
            raise ValueError("애플리케이션 유형에 맞는 토큰 인증 방식을 사용해야 합니다.")
    if portal_count != 1:
        raise ValueError("MedPark One 통합 인증 마스터가 하나 필요합니다.")
    return data


def load_manifest(path=MANIFEST_PATH):
    with Path(path).open(encoding="utf-8") as source:
        return validate_manifest(json.load(source))


def _registered_client(data, client_id):
    item = next((entry for entry in data["spaces"] if entry["client_id"] == client_id), None)
    if item is None:
        raise OAuthError("invalid_client", "등록되지 않은 클라이언트입니다.", 401)
    if item.get("kind") != "application" or not item.get("project_id") or not item.get("enabled"):
        raise OAuthError("unauthorized_client", "아직 연결할 수 없는 공간입니다.", 400)
    result = copy.deepcopy(item)
    result.update(_exact_site_urls(item["project_id"]))
    if result["token_endpoint_auth_method"] == "client_secret_basic":
        result["secret_env"] = _secret_env_name(result["space_label"])
    return result


def client_profile(data, client_id):
    client = _registered_client(validate_manifest(data), client_id)
    return {
        "schema_version": 2,
        "mode": "client",
        "enabled": True,
        "space_id": client["space_id"],
        "space_label": client["space_label"],
        "project_id": client["project_id"],
        "issuer": ISSUER,
        "discovery_url": ISSUER + "/.well-known/openid-configuration",
        "oidc_client": {
            "client_id": client["client_id"],
            "client_name": client["display_name"],
            "application_type": client["application_type"],
            "redirect_uris": [client["callback_uri"]],
            "post_logout_redirect_uris": [client["post_logout_redirect_uri"]],
            "backchannel_logout_uri": client["backchannel_logout_uri"],
            "backchannel_logout_session_required": True,
            "response_types": ["code"],
            "grant_types": ["authorization_code"],
            "token_endpoint_auth_method": client["token_endpoint_auth_method"],
            "pkce_method": "S256",
        },
        "account_linking": {
            "identity_key": ["iss", "sub"],
            "automatic_account_creation": False,
            "approval": "administrator_verified",
            "role_source": "local_application",
        },
        "secret_env": client.get("secret_env"),
        "notice": "인증키는 이 파일에 포함되지 않습니다. 사이트 환경변수에 별도로 등록해야 합니다.",
    }


def _client_readiness(client):
    if client.get("kind") == "portal":
        return "master_ready" if signing_ready() else "master_key_required"
    if not client.get("project_id"):
        return "reserved"
    if client["application_type"] == "browser":
        return "registered"
    return "registered" if os.environ.get(_secret_env_name(client["space_label"])) else "secret_required"


def overview(data):
    data = validate_manifest(copy.deepcopy(data))
    signing = signing_ready()
    registered = configured = 0
    for item in data["spaces"]:
        if item.get("project_id"):
            item.update(_exact_site_urls(item["project_id"]))
        item["connection_status"] = _client_readiness(item)
        if item.get("kind") == "application" and item.get("project_id"):
            registered += 1
            if item["connection_status"] == "registered" and signing:
                configured += 1
    data["summary"] = {
        "total_spaces": len(data["spaces"]),
        "occupied_spaces": sum(bool(item.get("project_id")) for item in data["spaces"]),
        "reserved_spaces": sum(not item.get("project_id") for item in data["spaces"]),
        "registered_clients": registered,
        "configured_clients": configured,
        "master_ready": signing,
    }
    data["endpoints"] = discovery_document(data)
    return data


def configuration_bundle(data):
    data = validate_manifest(data)
    return {
        "schema_version": 2,
        "mode": "master",
        "issuer": ISSUER,
        "inventory_checked_on": data["inventory_checked_on"],
        "excluded_integrations": ["amaranth"],
        "clients": [client_profile(data, item["client_id"]) for item in data["spaces"] if item.get("kind") == "application" and item.get("project_id")],
        "reserved_spaces": [{key: item[key] for key in ("space_id", "space_label", "client_id")} for item in data["spaces"] if not item.get("project_id")],
    }


def _load_signing_key():
    encoded = os.environ.get("SSO_SIGNING_PRIVATE_KEY_B64", "").strip()
    if not encoded:
        raise RuntimeError("SSO signing key is not configured")
    if _signing_cache["pem"] == encoded and _signing_cache["key"] is not None:
        return _signing_cache["key"]
    try:
        pem = base64.b64decode(encoded, validate=True)
        key = serialization.load_pem_private_key(pem, password=None)
        public = key.public_key().public_numbers()
        der = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        kid = hashlib.sha256(der).hexdigest()[:16]
        jwk = {"kty": "RSA", "use": "sig", "alg": "RS256", "kid": kid, "n": _b64url_int(public.n), "e": _b64url_int(public.e)}
    except Exception as exc:
        raise RuntimeError("SSO signing key is invalid") from exc
    _signing_cache.update(pem=encoded, key=key, jwk=jwk, kid=kid)
    return key


def signing_ready():
    try:
        _load_signing_key()
        state_secret()
        return True
    except RuntimeError:
        return False


def state_secret():
    value = os.environ.get("SSO_STATE_SECRET", "").strip()
    if len(value) < 32:
        raise RuntimeError("SSO state secret is not configured")
    return value


def jwks_document():
    _load_signing_key()
    return {"keys": [copy.deepcopy(_signing_cache["jwk"])]}


def _sign_jwt(claims, token_type="JWT"):
    key = _load_signing_key()
    header = {"alg": "RS256", "kid": _signing_cache["kid"], "typ": token_type}
    segments = [
        _b64url(json.dumps(header, separators=(",", ":"), sort_keys=True).encode()),
        _b64url(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode()),
    ]
    signing_input = ".".join(segments).encode("ascii")
    signature = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    return ".".join((*segments, _b64url(signature)))


def discovery_document(data=None):
    if data is not None:
        validate_manifest(data)
    return {
        "issuer": ISSUER,
        "authorization_endpoint": ISSUER + "/authorize",
        "token_endpoint": ISSUER + "/token",
        "userinfo_endpoint": ISSUER + "/userinfo",
        "jwks_uri": ISSUER + "/jwks.json",
        "end_session_endpoint": ISSUER + "/logout",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "scopes_supported": ["openid", "profile", "email"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic", "none"],
        "code_challenge_methods_supported": ["S256"],
        "claims_supported": ["iss", "sub", "aud", "exp", "iat", "auth_time", "nonce", "sid", "name", "preferred_username", "email", "employee_no", "department"],
        "backchannel_logout_supported": True,
        "backchannel_logout_session_supported": True,
    }


def _pending_serializer():
    return URLSafeTimedSerializer(state_secret(), salt="medpark-sso-pending-v1")


def _validate_authorization_request(data, args):
    client_id = str(args.get("client_id") or "")
    client = _registered_client(data, client_id)
    redirect_uri = str(args.get("redirect_uri") or "")
    if redirect_uri != client["callback_uri"]:
        raise OAuthError("invalid_request", "등록된 콜백 주소와 일치하지 않습니다.")
    state = str(args.get("state") or "")
    if not state or len(state) > 512:
        raise OAuthError("invalid_request", "state 값이 필요합니다.", redirect_uri=redirect_uri)
    def fail(error, message):
        raise OAuthError(error, message, redirect_uri=redirect_uri, state=state)
    if args.get("response_type") != "code":
        fail("unsupported_response_type", "authorization code 방식만 지원합니다.")
    scopes = [scope for scope in str(args.get("scope") or "").split() if scope]
    if "openid" not in scopes or any(scope not in ALLOWED_SCOPES for scope in scopes):
        fail("invalid_scope", "openid, profile, email 범위만 사용할 수 있습니다.")
    nonce = str(args.get("nonce") or "")
    if not nonce or len(nonce) > 512:
        fail("invalid_request", "nonce 값이 필요합니다.")
    challenge = str(args.get("code_challenge") or "")
    if args.get("code_challenge_method") != "S256" or not re.fullmatch(r"[A-Za-z0-9_-]{43}", challenge):
        fail("invalid_request", "S256 PKCE code_challenge가 필요합니다.")
    prompt = str(args.get("prompt") or "").strip()
    if prompt not in ("", "none"):
        fail("invalid_request", "지원하지 않는 prompt 값입니다.")
    return {"client_id": client_id, "redirect_uri": redirect_uri, "state": state, "response_type": "code", "scope": " ".join(dict.fromkeys(scopes)), "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256", "prompt": prompt}


def _redirect_error(error):
    if not error.redirect_uri:
        return _oauth_json(error.error, error.description, error.status)
    query = {"error": error.error, "error_description": error.description}
    if error.state:
        query["state"] = error.state
    separator = "&" if "?" in error.redirect_uri else "?"
    return redirect(error.redirect_uri + separator + parse.urlencode(query), code=302)


def _oauth_json(error, description, status=400):
    response = make_response(jsonify({"error": error, "error_description": description}), status)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _ensure_database_ready():
    try:
        core.ensure_database_ready()
    except core.AppError as exc:
        raise OAuthError("temporarily_unavailable", str(exc), 503) from exc


def _auth_code_record(params, user, session_key):
    code = secrets.token_urlsafe(48)
    now = _utcnow()
    record = {
        "code_hash": core.token_hash(code), "client_id": params["client_id"], "user_id": str(user["id"]),
        "session_key": session_key, "redirect_uri": params["redirect_uri"], "scope": params["scope"],
        "nonce": params["nonce"], "code_challenge": params["code_challenge"], "auth_time": now,
        "expires_at": now + AUTHORIZATION_CODE_TTL, "used_at": None,
    }
    if core.DB_ENABLED:
        core.execute("""INSERT INTO sso_authorization_codes
            (code_hash,client_id,user_id,session_key,redirect_uri,scope,nonce,code_challenge,auth_time,expires_at)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            tuple(record[key] for key in ("code_hash", "client_id", "user_id", "session_key", "redirect_uri", "scope", "nonce", "code_challenge", "auth_time", "expires_at")))
    else:
        with _memory_lock:
            _memory_codes[record["code_hash"]] = record
    return code


def _issue_authorization(params, user, session_token):
    code = _auth_code_record(params, user, core.token_hash(session_token))
    query = parse.urlencode({"code": code, "state": params["state"]})
    return redirect(params["redirect_uri"] + ("&" if "?" in params["redirect_uri"] else "?") + query, code=302)


def _consume_code(code, client_id, redirect_uri, verifier):
    hashed = core.token_hash(code)
    expected_challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    if core.DB_ENABLED:
        with core.connection() as conn:
            with conn.cursor(cursor_factory=core.psycopg2.extras.RealDictCursor) as cursor:
                cursor.execute("SELECT * FROM sso_authorization_codes WHERE code_hash=%s FOR UPDATE", (hashed,))
                row = cursor.fetchone()
                record = dict(row) if row else None
                if not record or record["used_at"] is not None or record["expires_at"] <= _utcnow():
                    raise OAuthError("invalid_grant", "인증 코드가 만료되었거나 이미 사용되었습니다.")
                if record["client_id"] != client_id or record["redirect_uri"] != redirect_uri:
                    raise OAuthError("invalid_grant", "인증 코드가 이 클라이언트에 발급되지 않았습니다.")
                if not hmac.compare_digest(record["code_challenge"], expected_challenge):
                    raise OAuthError("invalid_grant", "PKCE 검증에 실패했습니다.")
                cursor.execute("UPDATE sso_authorization_codes SET used_at=now() WHERE code_hash=%s", (hashed,))
                return record
    with _memory_lock:
        record = _memory_codes.get(hashed)
        if not record or record["used_at"] is not None or record["expires_at"] <= _utcnow():
            raise OAuthError("invalid_grant", "인증 코드가 만료되었거나 이미 사용되었습니다.")
        if record["client_id"] != client_id or record["redirect_uri"] != redirect_uri:
            raise OAuthError("invalid_grant", "인증 코드가 이 클라이언트에 발급되지 않았습니다.")
        if not hmac.compare_digest(record["code_challenge"], expected_challenge):
            raise OAuthError("invalid_grant", "PKCE 검증에 실패했습니다.")
        record["used_at"] = _utcnow()
        return dict(record)


def _basic_credentials():
    header = request.headers.get("Authorization", "")
    if not header.lower().startswith("basic "):
        return None, None
    try:
        decoded = base64.b64decode(header.split(None, 1)[1], validate=True).decode("utf-8")
        client_id, secret = decoded.split(":", 1)
        return parse.unquote(client_id), parse.unquote(secret)
    except (ValueError, UnicodeDecodeError):
        return None, None


def _authenticate_client(data):
    basic_id, basic_secret = _basic_credentials()
    form_id = str(request.form.get("client_id") or "")
    client_id = basic_id or form_id
    client = _registered_client(data, client_id)
    if client["token_endpoint_auth_method"] == "none":
        if basic_id or not form_id:
            raise OAuthError("invalid_client", "공개 클라이언트 인증 방식이 올바르지 않습니다.", 401)
        return client
    if not basic_id:
        raise OAuthError("invalid_client", "클라이언트 Basic 인증이 필요합니다.", 401)
    expected = os.environ.get(client["secret_env"], "")
    if not expected or not hmac.compare_digest(expected, basic_secret or ""):
        raise OAuthError("invalid_client", "클라이언트 인증에 실패했습니다.", 401)
    return client


def _user_claims(user, scope="openid profile email"):
    scopes = set(str(scope or "").split())
    claims = {"sub": str(user["id"])}
    if "profile" in scopes:
        claims.update(name=user.get("name") or "", preferred_username=user.get("username") or "", employee_no=user.get("employee_no") or "", department=user.get("department") or "")
    if "email" in scopes:
        claims["email"] = user.get("email") or ""
    return claims


def _issue_tokens(record, client):
    user = core.find_user_by_id(record["user_id"])
    if not user or user.get("status") != "active":
        raise OAuthError("invalid_grant", "활성 임직원 계정을 확인할 수 없습니다.")
    now = _utcnow()
    sid = secrets.token_urlsafe(24)
    access_token = secrets.token_urlsafe(48)
    token_record = {"token_hash": core.token_hash(access_token), "client_id": client["client_id"], "user_id": str(user["id"]), "session_key": record["session_key"], "sid": sid, "scope": record["scope"], "expires_at": now + ACCESS_TOKEN_TTL, "revoked_at": None}
    if core.DB_ENABLED:
        core.execute("""INSERT INTO sso_access_tokens
            (token_hash,client_id,user_id,session_key,sid,scope,expires_at)
            VALUES(%s,%s,%s,%s,%s,%s,%s)""",
            tuple(token_record[key] for key in ("token_hash", "client_id", "user_id", "session_key", "sid", "scope", "expires_at")))
    else:
        with _memory_lock:
            _memory_tokens[token_record["token_hash"]] = token_record
    claims = {"iss": ISSUER, "sub": str(user["id"]), "aud": client["client_id"], "exp": int((now + ID_TOKEN_TTL).timestamp()), "iat": int(now.timestamp()), "auth_time": int(record["auth_time"].timestamp()), "nonce": record["nonce"], "sid": sid, **_user_claims(user, record["scope"])}
    return {"access_token": access_token, "token_type": "Bearer", "expires_in": int(ACCESS_TOKEN_TTL.total_seconds()), "scope": record["scope"], "id_token": _sign_jwt(claims)}


def _bearer_token():
    header = request.headers.get("Authorization", "")
    return header[7:].strip() if header.lower().startswith("bearer ") else ""


def _access_record(token):
    hashed = core.token_hash(token)
    if core.DB_ENABLED:
        return core.fetchone("""SELECT t.*,u.username,u.email,u.name,u.employee_no,u.department,u.status
            FROM sso_access_tokens t JOIN users u ON u.id=t.user_id
            WHERE t.token_hash=%s AND t.revoked_at IS NULL AND t.expires_at>now() AND u.status='active'""", (hashed,))
    with _memory_lock:
        record = _memory_tokens.get(hashed)
        if not record or record["revoked_at"] is not None or record["expires_at"] <= _utcnow():
            return None
        user = core.find_user_by_id(record["user_id"])
        return {**record, **(user or {})} if user and user.get("status") == "active" else None


def _backchannel_logout_token(client_id, sid):
    now = int(time.time())
    return _sign_jwt({"iss": ISSUER, "aud": client_id, "iat": now, "jti": str(uuid.uuid4()), "sid": sid, "events": {"http://schemas.openid.net/event/backchannel-logout": {}}}, token_type="logout+jwt")


def _dispatch_backchannel(targets):
    data = load_manifest()
    for client_id, sid in targets:
        try:
            client = _registered_client(data, client_id)
            payload = parse.urlencode({"logout_token": _backchannel_logout_token(client_id, sid)}).encode()
            req = urlrequest.Request(client["backchannel_logout_uri"], data=payload, headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "MedPark-One-SSO/1.0"}, method="POST")
            with urlrequest.urlopen(req, timeout=2) as response:
                response.read(1)
        except Exception:
            continue


def revoke_portal_session(session_token):
    if not session_token:
        return 0
    session_key = core.token_hash(session_token)
    targets = []
    if core.DB_ENABLED:
        targets = [(row["client_id"], row["sid"]) for row in core.fetchall("SELECT DISTINCT client_id,sid FROM sso_access_tokens WHERE session_key=%s AND revoked_at IS NULL", (session_key,))]
        core.execute("UPDATE sso_access_tokens SET revoked_at=now() WHERE session_key=%s AND revoked_at IS NULL", (session_key,))
    else:
        with _memory_lock:
            for record in _memory_tokens.values():
                if record["session_key"] == session_key and record["revoked_at"] is None:
                    targets.append((record["client_id"], record["sid"]))
                    record["revoked_at"] = _utcnow()
    if targets and signing_ready():
        threading.Thread(target=_dispatch_backchannel, args=(targets,), daemon=True).start()
    return len(targets)


def install(app, require_user, require_admin, manifest_path=MANIFEST_PATH):
    if "sso_authorize" in app.view_functions:
        return

    def read_manifest():
        try:
            return load_manifest(manifest_path)
        except (OSError, ValueError, TypeError, KeyError) as exc:
            app.logger.error("Invalid SSO master manifest: %s", exc)
            raise OAuthError("server_error", "중앙 인증 설정을 확인해 주세요.", 503) from exc

    def admin_response(payload, status=200, filename=None):
        response = make_response(jsonify(payload), status)
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["X-Content-Type-Options"] = "nosniff"
        if filename:
            response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @app.get("/.well-known/openid-configuration")
    @app.get("/sso/.well-known/openid-configuration")
    def sso_discovery():
        try:
            document = discovery_document(read_manifest())
        except OAuthError as exc:
            return _oauth_json(exc.error, exc.description, exc.status)
        response = make_response(jsonify(document))
        response.headers["Cache-Control"] = "public, max-age=300"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/sso/jwks.json")
    def sso_jwks():
        try:
            document = jwks_document()
        except RuntimeError:
            return _oauth_json("temporarily_unavailable", "중앙 인증 서명키를 준비하는 중입니다.", 503)
        response = make_response(jsonify(document))
        response.headers["Cache-Control"] = "public, max-age=300"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/sso/health")
    def sso_health():
        try:
            data = read_manifest()
            registered = sum(item.get("kind") == "application" and bool(item.get("project_id")) for item in data["spaces"])
            database = core.database_status()
            ready = signing_ready() and database["database_state"] == "ready" and database.get("plaud_schema_ready", True)
            return admin_response({"status": "ready" if ready else "configuration_required", "issuer": ISSUER, "registered_clients": registered, "signing_ready": signing_ready(), "database_ready": database["database_state"] == "ready" and database.get("plaud_schema_ready", True)}, 200 if ready else 503)
        except OAuthError as exc:
            return _oauth_json(exc.error, exc.description, exc.status)

    @app.get("/sso/authorize")
    def sso_authorize():
        try:
            _ensure_database_ready()
            params = _validate_authorization_request(read_manifest(), request.args)
            session_token = request.cookies.get(core.SESSION_COOKIE)
            user = core.get_session_user(session_token)
            if not user:
                if params["prompt"] == "none":
                    raise OAuthError("login_required", "MedPark One 로그인이 필요합니다.", redirect_uri=params["redirect_uri"], state=params["state"])
                pending = _pending_serializer().dumps(params)
                response = redirect("/?sso=login", code=302)
                response.set_cookie(PENDING_COOKIE, pending, max_age=PENDING_TTL_SECONDS, httponly=True, secure=_is_secure_request(), samesite="Lax", path="/sso")
                return response
            return _issue_authorization(params, user, session_token)
        except OAuthError as exc:
            return _redirect_error(exc)
        except RuntimeError:
            return _oauth_json("temporarily_unavailable", "중앙 인증 보안 설정을 준비하는 중입니다.", 503)

    @app.get("/sso/resume")
    def sso_resume():
        raw = request.cookies.get(PENDING_COOKIE)
        if not raw:
            return redirect("/", code=302)
        try:
            _ensure_database_ready()
            params = _pending_serializer().loads(raw, max_age=PENDING_TTL_SECONDS)
            params = _validate_authorization_request(read_manifest(), params)
            session_token = request.cookies.get(core.SESSION_COOKIE)
            user = core.get_session_user(session_token)
            if not user:
                return redirect("/?sso=login", code=302)
            response = _issue_authorization(params, user, session_token)
        except SignatureExpired:
            response = redirect("/?sso=expired", code=302)
        except (BadSignature, OAuthError, RuntimeError):
            response = redirect("/?sso=invalid", code=302)
        response.delete_cookie(PENDING_COOKIE, path="/sso")
        return response

    @app.route("/sso/token", methods=["POST", "OPTIONS"])
    def sso_token():
        origin = request.headers.get("Origin", "")
        if request.method == "OPTIONS":
            response = make_response("", 204)
            if origin:
                try:
                    data = read_manifest()
                    client = next((_registered_client(data, item["client_id"]) for item in data["spaces"] if item.get("kind") == "application" and item.get("project_id") and item.get("application_type") == "browser" and _exact_site_urls(item["project_id"])["public_url"] == origin), None)
                    if client:
                        response.headers.update({"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", "Vary": "Origin"})
                except (OAuthError, StopIteration):
                    pass
            return response
        try:
            _ensure_database_ready()
            data = read_manifest()
            client = _authenticate_client(data)
            if request.form.get("grant_type") != "authorization_code":
                raise OAuthError("unsupported_grant_type", "authorization_code 방식만 지원합니다.")
            redirect_uri = str(request.form.get("redirect_uri") or "")
            if redirect_uri != client["callback_uri"]:
                raise OAuthError("invalid_grant", "등록된 콜백 주소와 일치하지 않습니다.")
            code = str(request.form.get("code") or "")
            verifier = str(request.form.get("code_verifier") or "")
            if not code or not PKCE_VERIFIER.fullmatch(verifier):
                raise OAuthError("invalid_request", "인증 코드와 PKCE code_verifier가 필요합니다.")
            token_payload = _issue_tokens(_consume_code(code, client["client_id"], redirect_uri, verifier), client)
            response = make_response(jsonify(token_payload))
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
            if origin and client["application_type"] == "browser" and origin == client["public_url"]:
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Vary"] = "Origin"
            return response
        except OAuthError as exc:
            response = _oauth_json(exc.error, exc.description, exc.status)
            if exc.error == "invalid_client":
                response.headers["WWW-Authenticate"] = 'Basic realm="MedPark One SSO"'
            return response
        except RuntimeError:
            return _oauth_json("temporarily_unavailable", "중앙 인증 보안 설정을 준비하는 중입니다.", 503)

    @app.get("/sso/userinfo")
    def sso_userinfo():
        try:
            _ensure_database_ready()
        except OAuthError as exc:
            return _oauth_json(exc.error, exc.description, exc.status)
        token = _bearer_token()
        record = _access_record(token) if token else None
        if not record:
            response = _oauth_json("invalid_token", "유효한 액세스 토큰이 필요합니다.", 401)
            response.headers["WWW-Authenticate"] = 'Bearer error="invalid_token"'
            return response
        response = make_response(jsonify(_user_claims(record, record.get("scope"))))
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/sso/logout")
    def sso_logout():
        try:
            _ensure_database_ready()
            data = read_manifest()
        except OAuthError as exc:
            return _oauth_json(exc.error, exc.description, exc.status)
        client_id = str(request.args.get("client_id") or "")
        target = PORTAL_URL + "/"
        if client_id:
            try:
                client = _registered_client(data, client_id)
                requested = str(request.args.get("post_logout_redirect_uri") or "")
                if requested and requested != client["post_logout_redirect_uri"]:
                    raise OAuthError("invalid_request", "등록된 로그아웃 이동 주소와 일치하지 않습니다.")
                target = requested or client["post_logout_redirect_uri"]
            except OAuthError as exc:
                return _oauth_json(exc.error, exc.description, exc.status)
        session_token = request.cookies.get(core.SESSION_COOKIE)
        revoke_portal_session(session_token)
        core.delete_session(session_token)
        response = redirect(target, code=302)
        response.delete_cookie(core.SESSION_COOKIE, path="/")
        return response

    @app.get("/api/admin/sso/master")
    def sso_master_overview():
        require_admin(True)
        try:
            return admin_response(overview(read_manifest()))
        except OAuthError as exc:
            return admin_response({"message": exc.description}, exc.status)

    @app.get("/api/admin/sso/master/export")
    def sso_master_export():
        require_admin(True)
        try:
            return admin_response(configuration_bundle(read_manifest()), filename="medpark-sso-master.json")
        except OAuthError as exc:
            return admin_response({"message": exc.description}, exc.status)

    @app.get("/api/admin/sso/master/clients/<client_id>/config")
    def sso_master_client(client_id):
        require_admin(True)
        try:
            return admin_response(client_profile(read_manifest(), client_id), filename=client_id + ".json")
        except OAuthError as exc:
            status = 404 if exc.error == "invalid_client" else 409
            return admin_response({"message": exc.description}, status)
