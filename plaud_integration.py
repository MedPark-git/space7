import base64
import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest

import portal_core as core


logger = logging.getLogger("medpark.plaud")


ALLOWED_FILE_TYPES = {"mp3", "opus"}
MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024
MAX_PROXY_CHUNK_SIZE = 8 * 1024 * 1024
PROXY_TOKEN_LIFETIME = 60 * 60
ACTIVE_STATUSES = {"uploading", "processing"}
PLAUD_ACTIVE_STATUSES = {"PENDING", "RECEIVED", "STARTED", "PROGRESS"}
PLAUD_FAILED_STATUSES = {"FAILURE", "REVOKED"}

_token_lock = threading.Lock()
_token_cache = {"partner": None, "users": {}}
_memory_meetings = {}


def _credentials():
    host = (os.environ.get("PLAUD_API_HOST") or "https://platform-us.plaud.ai").strip().rstrip("/")
    if not host.startswith("https://"):
        host = "https://platform-us.plaud.ai"
    return {
        "host": host,
        "client_id": (os.environ.get("PLAUD_CLIENT_ID") or "").strip(),
        "client_secret": (os.environ.get("PLAUD_CLIENT_SECRET") or "").strip(),
        "api_key": (os.environ.get("PLAUD_API_KEY") or "").strip(),
    }


def configured():
    credentials = _credentials()
    return all(credentials[key] for key in ("client_id", "client_secret", "api_key"))


def configuration_payload():
    ready = configured()
    return {
        "provider": "PLAUD",
        "configured": ready,
        "status": "ready" if ready else "waiting",
        "message": "PLAUD 연결이 준비되었습니다." if ready else "관리자가 PLAUD Developer API 인증정보를 등록하면 업로드할 수 있습니다.",
        "supported_file_types": sorted(ALLOWED_FILE_TYPES),
        "max_file_size": MAX_FILE_SIZE,
        "chunk_upload": True,
        "connection_test_available": True,
    }


def _safe_upstream_message(raw, fallback):
    try:
        details = json.loads(raw)
        message = details.get("message") or details.get("detail") or details.get("error") or fallback
    except (ValueError, AttributeError, TypeError):
        message = raw or fallback
    safe_message = str(message)
    credentials = _credentials()
    for secret in (credentials["client_id"], credentials["client_secret"], credentials["api_key"]):
        if secret:
            safe_message = safe_message.replace(secret, "[보호됨]")
    safe_message = re.sub(r"eyJ[A-Za-z0-9_.-]{20,}", "[보호된 토큰]", safe_message)
    return re.sub(r"\s+", " ", safe_message).strip()[:180]


def _open_plaud_request(req, timeout, stage):
    direct_opener = urlrequest.build_opener(urlrequest.ProxyHandler({}))
    try:
        logger.info("PLAUD direct connection attempt stage=%s", stage)
        return direct_opener.open(req, timeout=timeout)
    except urlerror.HTTPError:
        raise
    except (urlerror.URLError, TimeoutError) as exc:
        logger.warning(
            "PLAUD direct connection unavailable; retrying with system network stage=%s error=%s",
            stage,
            type(exc).__name__,
        )
        return urlrequest.urlopen(req, timeout=timeout)


def _http_json(method, path, *, headers=None, payload=None, form=None, timeout=20, stage="PLAUD API"):
    credentials = _credentials()
    body = None
    request_headers = {
        "Accept": "application/json",
        "User-Agent": "curl/8.5.0",
        "Connection": "close",
        **(headers or {}),
    }
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")
    elif form is not None:
        body = urlparse.urlencode(form).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
    elif method.upper() in {"POST", "PUT", "PATCH"}:
        body = b""
    req = urlrequest.Request(
        f"{credentials['host']}{path}", data=body, headers=request_headers, method=method.upper()
    )
    logger.info("PLAUD request started stage=%s method=%s path=%s", stage, method.upper(), path)
    try:
        with _open_plaud_request(req, timeout, stage) as response:
            raw = response.read().decode("utf-8")
            logger.info("PLAUD request completed stage=%s status=%s", stage, getattr(response, "status", 200))
            return json.loads(raw) if raw else {}
    except urlerror.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        detail = _safe_upstream_message(raw, f"HTTP {exc.code}")
        logger.warning("PLAUD request rejected stage=%s status=%s detail=%s", stage, exc.code, detail)
        if exc.code in {401, 403}:
            if stage.startswith("1/3"):
                message = (
                    f"{stage}: PLAUD가 AI SPACE 서버 요청을 거부했습니다. "
                    f"HTTP {exc.code} ({detail})"
                )
            elif stage.startswith("2/3"):
                message = f"{stage}: PLAUD User Token 인증이 거부되었습니다. HTTP {exc.code} ({detail})"
            else:
                message = f"{stage}: PLAUD API 인증이 거부되었습니다. HTTP {exc.code} ({detail})"
        elif exc.code == 429:
            message = f"{stage}: PLAUD API 호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."
        elif exc.code >= 500:
            message = f"{stage}: PLAUD 서비스에서 일시적인 오류가 발생했습니다."
        else:
            message = f"{stage}: PLAUD 요청이 거부되었습니다. ({detail})"
        raise core.AppError(message, 502) from exc
    except (urlerror.URLError, TimeoutError) as exc:
        logger.warning("PLAUD connection failed stage=%s error=%s", stage, type(exc).__name__)
        raise core.AppError(f"{stage}: PLAUD 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503) from exc

def _require_configured():
    if not configured():
        raise core.AppError("PLAUD Developer API 인증정보가 아직 등록되지 않았습니다.", 503)


def _partner_token():
    _require_configured()
    now = time.time()
    with _token_lock:
        cached = _token_cache.get("partner")
        if cached and cached["expires_at"] > now + 60:
            return cached["access_token"]
        credentials = _credentials()
        encoded = base64.b64encode(f"{credentials['client_id']}:{credentials['client_secret']}".encode()).decode()
        result = _http_json(
            "POST",
            "/developer/api/oauth/partner/access-token",
            headers={"Authorization": f"Basic {encoded}"},
            form={},
            stage="1/3 Partner Token 인증",
        )
        access_token = result.get("access_token")
        if not access_token:
            raise core.AppError("PLAUD Partner Token을 발급받지 못했습니다.", 502)
        expires_in = max(120, int(result.get("expires_in") or 3600))
        _token_cache["partner"] = {"access_token": access_token, "expires_at": now + expires_in}
        return access_token


def _user_token(user_id):
    stable_user_id = str(user_id)
    now = time.time()
    with _token_lock:
        cached = _token_cache["users"].get(stable_user_id)
        if cached and cached["expires_at"] > now + 60:
            return cached["access_token"]
    partner_token = _partner_token()
    result = _http_json(
        "POST",
        "/developer/api/open/partner/users/access-token",
        headers={"Authorization": f"Bearer {partner_token}"},
        payload={"user_id": stable_user_id, "expires_in": 86400},
        stage="2/3 User Token 인증",
    )
    access_token = result.get("access_token")
    if not access_token:
        raise core.AppError("PLAUD User Token을 발급받지 못했습니다.", 502)
    expires_in = max(120, int(result.get("expires_in") or 86400))
    with _token_lock:
        _token_cache["users"][stable_user_id] = {"access_token": access_token, "expires_at": now + expires_in}
    return access_token


def _test_transcription_credentials():
    credentials = _credentials()
    test_id = "task_exec_medpark_connection_test"
    path = f"/developer/api/open/partner/ai/transcriptions/{test_id}"
    req = urlrequest.Request(
        f"{credentials['host']}{path}",
        headers={
            "Accept": "application/json",
            "User-Agent": "curl/8.5.0",
            "Connection": "close",
            "X-Client-Id": credentials["client_id"],
            "X-Client-Api-Key": credentials["api_key"],
        },
        method="GET",
    )
    logger.info("PLAUD authentication probe started stage=3/3 Transcription API")
    try:
        with _open_plaud_request(req, 12, "3/3 Transcription API") as response:
            response.read()
            logger.info("PLAUD authentication probe completed status=%s", getattr(response, "status", 200))
    except urlerror.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        detail = _safe_upstream_message(raw, f"HTTP {exc.code}")
        if exc.code in {400, 404, 422}:
            logger.info("PLAUD authentication probe accepted credentials status=%s", exc.code)
            return
        logger.warning("PLAUD authentication probe failed status=%s detail=%s", exc.code, detail)
        if exc.code in {401, 403}:
            raise core.AppError("3/3 Transcription API 인증: PLAUD API Key가 거부되었습니다.", 502) from exc
        if exc.code == 429:
            raise core.AppError("3/3 Transcription API 인증: PLAUD API 호출 한도에 도달했습니다.", 502) from exc
        raise core.AppError(f"3/3 Transcription API 인증: PLAUD 응답을 확인하지 못했습니다. ({detail})", 502) from exc
    except (urlerror.URLError, TimeoutError) as exc:
        logger.warning("PLAUD authentication probe connection failed error=%s", type(exc).__name__)
        raise core.AppError("3/3 Transcription API 인증: PLAUD 서비스에 연결할 수 없습니다.", 503) from exc


def test_connection(user_id):
    _require_configured()
    logger.info("PLAUD connection test started user_id=%s", str(user_id))
    _partner_token()
    _user_token(user_id)
    _test_transcription_credentials()
    checked_at = datetime.now(timezone.utc).isoformat()
    logger.info("PLAUD connection test completed user_id=%s", str(user_id))
    return {
        "connected": True,
        "provider": "PLAUD",
        "partner_token": "verified",
        "user_token": "verified",
        "transcription_api": "verified",
        "checked_at": checked_at,
        "message": "PLAUD Partner Token, User Token 및 Transcription API 인증이 정상입니다.",
    }


def _clean_filename(filename):
    value = os.path.basename(str(filename or "").strip().replace("\\", "/"))[:255]
    if not value or "." not in value:
        raise core.AppError("올바른 녹음파일을 선택해 주세요.")
    return value


def _file_type(filename, requested=None):
    extension = (str(requested or "").strip().lower() or filename.rsplit(".", 1)[-1].lower())
    if extension not in ALLOWED_FILE_TYPES:
        raise core.AppError("현재 PLAUD 직접 업로드는 MP3 또는 OPUS 파일만 지원합니다.")
    return extension


def _title(value, filename):
    title = str(value or os.path.splitext(filename)[0] or "새 회의록").strip()
    title = re.sub(r"[\x00-\x1f\x7f]", " ", title)
    title = re.sub(r"\s+", " ", title)[:200]
    return title or "새 회의록"


def _bounded_int(value, default, minimum, maximum):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def mask_title(title):
    text = str(title or "회의록").strip()
    if len(text) <= 1:
        return "•"
    visible = min(2, len(text))
    return f"{text[:visible]}{'•' * max(4, min(12, len(text) - visible))}"


def _validate_presigned_upload_url(value):
    upload_url = str(value or "").strip()
    try:
        parsed = urlparse.urlsplit(upload_url)
        port = parsed.port
    except (ValueError, TypeError) as exc:
        raise core.AppError("PLAUD 업로드 주소 형식이 올바르지 않습니다.", 400) from exc
    host = (parsed.hostname or "").lower().rstrip(".")
    is_s3_host = (
        host == "s3.amazonaws.com"
        or host.startswith("s3.")
        or ".s3." in host
        or host.endswith(".s3.amazonaws.com")
    )
    query_keys = {key.lower() for key, _ in urlparse.parse_qsl(parsed.query, keep_blank_values=True)}
    if (
        parsed.scheme != "https"
        or not host.endswith(".amazonaws.com")
        or not is_s3_host
        or parsed.username
        or parsed.password
        or port not in (None, 443)
        or "x-amz-signature" not in query_keys
    ):
        raise core.AppError("허용되지 않은 PLAUD 업로드 주소입니다.", 400)
    return upload_url


def _make_upload_proxy_token(upload_url, user_id, part_number):
    expires_at = int(time.time()) + PROXY_TOKEN_LIFETIME
    credentials = _credentials()
    signing_key = f"{credentials['client_secret']}:{credentials['api_key']}".encode("utf-8")
    message = f"{user_id}\n{part_number}\n{expires_at}\n{upload_url}".encode("utf-8")
    signature = hmac.new(signing_key, message, hashlib.sha256).hexdigest()
    return f"{expires_at}.{signature}"


def _verify_upload_proxy_token(token, upload_url, user_id, part_number):
    try:
        expires_text, supplied = str(token or "").split(".", 1)
        expires_at = int(expires_text)
    except (TypeError, ValueError):
        raise core.AppError("PLAUD 업로드 보안 토큰이 올바르지 않습니다.", 403)
    if expires_at < int(time.time()) or expires_at > int(time.time()) + PROXY_TOKEN_LIFETIME + 60:
        raise core.AppError("PLAUD 업로드 보안 토큰이 만료되었습니다. 파일 업로드를 다시 시작해 주세요.", 403)
    credentials = _credentials()
    signing_key = f"{credentials['client_secret']}:{credentials['api_key']}".encode("utf-8")
    message = f"{user_id}\n{part_number}\n{expires_at}\n{upload_url}".encode("utf-8")
    expected = hmac.new(signing_key, message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(supplied, expected):
        raise core.AppError("PLAUD 업로드 보안 토큰 검증에 실패했습니다.", 403)


def start_upload(data, user):
    _require_configured()
    filename = _clean_filename(data.get("filename"))
    file_type = _file_type(filename, data.get("file_type"))
    try:
        file_size = int(data.get("file_size") or 0)
    except (TypeError, ValueError):
        file_size = 0
    if file_size <= 0:
        raise core.AppError("녹음파일 크기를 확인할 수 없습니다.")
    if file_size > MAX_FILE_SIZE:
        raise core.AppError("녹음파일은 최대 2GB까지 업로드할 수 있습니다.")
    logger.info("PLAUD upload start user_id=%s file_type=%s file_size=%s", str(user["id"]), file_type, file_size)
    token = _user_token(user["id"])
    result = _http_json(
        "POST",
        "/developer/api/open/partner/files/upload/generate-presigned-urls",
        headers={"Authorization": f"Bearer {token}"},
        payload={"filesize": file_size, "filetype": file_type},
        stage="1/5 업로드 인증 및 주소 발급",
    )
    file_id = result.get("FileId") or result.get("file_id")
    upload_id = result.get("UploadId") or result.get("upload_id")
    chunk_size = result.get("ChunkSize") or result.get("chunk_size")
    parts = result.get("Parts") or result.get("parts") or []
    if not file_id or not upload_id or not chunk_size or not parts:
        raise core.AppError("PLAUD 업로드 주소를 발급받지 못했습니다.", 502)
    normalized_parts = []
    for part in parts:
        try:
            part_number = int(part.get("PartNumber") or part.get("part_number"))
        except (TypeError, ValueError, AttributeError):
            raise core.AppError("PLAUD 업로드 조각 정보가 올바르지 않습니다.", 502)
        upload_url = str(part.get("PresignedUrl") or part.get("presigned_url") or "").strip()
        if part_number < 1 or not upload_url.startswith("https://"):
            raise core.AppError("PLAUD 업로드 주소가 올바르지 않습니다.", 502)
        upload_url = _validate_presigned_upload_url(upload_url)
        normalized_parts.append({
            "part_number": part_number,
            "upload_url": upload_url,
            "proxy_token": _make_upload_proxy_token(upload_url, user["id"], part_number),
        })
    return {
        "file_id": file_id,
        "upload_id": upload_id,
        "chunk_size": int(chunk_size),
        "file_type": file_type,
        "parts": normalized_parts,
    }


def upload_part(upload_url, proxy_token, part_number, chunk, user):
    _require_configured()
    try:
        number = int(part_number)
    except (TypeError, ValueError) as exc:
        raise core.AppError("업로드 조각 번호가 올바르지 않습니다.") from exc
    if number < 1 or number > 10000:
        raise core.AppError("업로드 조각 번호가 허용 범위를 벗어났습니다.")
    upload_url = _validate_presigned_upload_url(upload_url)
    _verify_upload_proxy_token(proxy_token, upload_url, user["id"], number)
    if not isinstance(chunk, (bytes, bytearray)) or not chunk:
        raise core.AppError("업로드할 파일 조각이 비어 있습니다.")
    if len(chunk) > MAX_PROXY_CHUNK_SIZE:
        raise core.AppError("파일 조각 크기가 서버 전송 한도를 초과했습니다.", 413)
    parsed = urlparse.urlsplit(upload_url)
    logger.info(
        "PLAUD proxy upload started user_id=%s part=%s size=%s host=%s",
        str(user["id"]),
        number,
        len(chunk),
        parsed.hostname,
    )
    req = urlrequest.Request(
        upload_url,
        data=bytes(chunk),
        headers={
            "Content-Length": str(len(chunk)),
            "User-Agent": "curl/8.5.0",
            "Connection": "close",
        },
        method="PUT",
    )
    try:
        with _open_plaud_request(req, 90, f"2/5 파일 전송 {number}번 조각") as response:
            response.read()
            etag = response.headers.get("ETag") or response.headers.get("etag")
            if not etag:
                raise core.AppError(f"2/5 파일 전송: {number}번 조각의 ETag를 받지 못했습니다.", 502)
            logger.info(
                "PLAUD proxy upload completed user_id=%s part=%s status=%s",
                str(user["id"]),
                number,
                getattr(response, "status", 200),
            )
            return {"PartNumber": number, "ETag": etag}
    except urlerror.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        detail = _safe_upstream_message(raw, f"HTTP {exc.code}")
        logger.warning(
            "PLAUD proxy upload rejected user_id=%s part=%s status=%s detail=%s",
            str(user["id"]),
            number,
            exc.code,
            detail,
        )
        raise core.AppError(
            f"2/5 파일 전송: {number}번 조각이 PLAUD 저장소에서 거부되었습니다. HTTP {exc.code} ({detail})",
            502,
        ) from exc
    except core.AppError:
        raise
    except (urlerror.URLError, TimeoutError) as exc:
        logger.warning(
            "PLAUD proxy upload connection failed user_id=%s part=%s error=%s",
            str(user["id"]),
            number,
            type(exc).__name__,
        )
        raise core.AppError(
            f"2/5 파일 전송: {number}번 조각을 PLAUD 저장소로 전송하지 못했습니다.",
            503,
        ) from exc


def _create_meeting(values):
    meeting_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    row = {"id": meeting_id, "created_at": now, "updated_at": now, "completed_at": None, **values}
    if core.DB_ENABLED:
        return core.execute(
            """INSERT INTO plaud_meetings(
                 id,created_by,title,source_filename,file_size,file_type,plaud_file_id,
                 plaud_transcription_id,status,plaud_status
               ) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (
                meeting_id, values["created_by"], values["title"], values["source_filename"],
                values["file_size"], values["file_type"], values["plaud_file_id"],
                values["plaud_transcription_id"], values["status"], values["plaud_status"],
            ),
        )
    _memory_meetings[meeting_id] = row
    return dict(row)


def complete_upload(data, user, ip=None):
    _require_configured()
    filename = _clean_filename(data.get("filename"))
    file_type = _file_type(filename, data.get("file_type"))
    file_id = str(data.get("file_id") or "").strip()
    upload_id = str(data.get("upload_id") or "").strip()
    parts = data.get("part_list") or []
    if not file_id or not upload_id or not isinstance(parts, list) or not parts:
        raise core.AppError("PLAUD 업로드 완료 정보가 올바르지 않습니다.")
    normalized_parts = []
    for item in parts[:10000]:
        try:
            number = int(item.get("PartNumber") or item.get("part_number"))
        except (TypeError, ValueError, AttributeError):
            raise core.AppError("업로드 조각 번호가 올바르지 않습니다.")
        etag = str((item or {}).get("ETag") or (item or {}).get("etag") or "").strip()
        if not etag:
            raise core.AppError("업로드 조각 확인값을 찾을 수 없습니다.")
        normalized_parts.append({"PartNumber": number, "ETag": etag})
    token = _user_token(user["id"])
    complete_result = _http_json(
        "POST",
        "/developer/api/open/partner/files/upload/complete-upload",
        headers={"Authorization": f"Bearer {token}"},
        payload={"file_id": file_id, "upload_id": upload_id, "part_list": normalized_parts, "filetype": file_type},
        stage="3/5 업로드 파일 결합",
    )
    download_url = complete_result.get("DownloadUrl") or complete_result.get("download_url")
    if not download_url:
        raise core.AppError("PLAUD 업로드 파일 주소를 확인하지 못했습니다.", 502)
    credentials = _credentials()
    transcription = _http_json(
        "POST",
        "/developer/api/open/partner/ai/transcriptions/",
        headers={"X-Client-Id": credentials["client_id"], "X-Client-Api-Key": credentials["api_key"]},
        payload={
            "file_url": download_url,
            "params": {
                "transcribe": {"language": "auto", "model": "plaud-fast-whisper"},
                "vad": {"decode_silence": False},
                "diarization": {"enabled": True, "return_embedding": False},
            },
        },
        stage="4/5 PLAUD 전사 작업 생성",
    )
    transcription_id = transcription.get("transcription_id")
    plaud_status = str(transcription.get("status") or "PENDING").upper()
    if not transcription_id:
        raise core.AppError("PLAUD 전사 작업을 생성하지 못했습니다.", 502)
    try:
        file_size = max(0, int(data.get("file_size") or 0))
    except (TypeError, ValueError):
        file_size = 0
    try:
        row = _create_meeting({
            "created_by": str(user["id"]),
            "title": _title(data.get("title"), filename),
            "source_filename": filename,
            "file_size": file_size,
            "file_type": file_type,
            "plaud_file_id": file_id,
            "plaud_transcription_id": transcription_id,
            "status": "processing",
            "plaud_status": plaud_status,
            "created_by_name": user.get("name") or user.get("username") or "임직원",
        })
    except core.AppError:
        raise
    except Exception as exc:
        logger.exception("PLAUD meeting DB insert failed user_id=%s transcription_id=%s", str(user["id"]), transcription_id)
        raise core.AppError("5/5 회의록 DB 저장 단계에서 오류가 발생했습니다. 관리자에게 문의해 주세요.", 500) from exc
    try:
        core.write_audit(user["id"], "plaud.meeting.create", "plaud_meeting", str(row["id"]), {"status": "processing"}, ip)
    except Exception:
        logger.exception("PLAUD audit log write failed meeting_id=%s", str(row["id"]))
    logger.info("PLAUD upload workflow completed meeting_id=%s transcription_id=%s", str(row["id"]), transcription_id)
    return public_meeting(row, user)


def public_meeting(row, actor=None, detail=False):
    if not row:
        return None
    can_view_title = bool(actor) and (actor.get("role") == "admin" or str(actor.get("id")) == str(row.get("created_by")))
    result = {
        "id": str(row.get("id")),
        "masked_title": mask_title(row.get("title")),
        "status": row.get("status") or "processing",
        "plaud_status": row.get("plaud_status") or "",
        "file_type": row.get("file_type") or "",
        "file_size": int(row.get("file_size") or 0),
        "duration_seconds": float(row.get("duration_seconds") or 0),
        "language": row.get("language") or "",
        "created_by_name": row.get("created_by_name") or "임직원",
        "created_at": core.iso(row.get("created_at")),
        "updated_at": core.iso(row.get("updated_at")),
        "completed_at": core.iso(row.get("completed_at")),
        "can_view_title": can_view_title,
    }
    if detail:
        result.update({
            "title": row.get("title") if can_view_title else None,
            "source_filename": row.get("source_filename") if can_view_title else None,
            "transcript": row.get("transcript") or "",
            "segments": row.get("transcript_segments") or [],
            "error_message": row.get("error_message") or "",
        })
    return result


def _where_clause(query="", status=""):
    clauses = []
    params = []
    status = str(status or "").strip().lower()
    if status in {"processing", "completed", "failed"}:
        clauses.append("m.status=%s")
        params.append(status)
    query = str(query or "").strip()[:100]
    if query:
        clauses.append("m.title ILIKE %s")
        params.append(f"%{query}%")
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), params


def list_meetings(actor, query="", status="", page=1, page_size=20):
    page = _bounded_int(page, 1, 1, 100000)
    page_size = _bounded_int(page_size, 20, 5, 50)
    if not core.DB_ENABLED:
        rows = list(_memory_meetings.values())
        if status:
            rows = [row for row in rows if row.get("status") == status]
        if query:
            rows = [row for row in rows if query.lower() in row.get("title", "").lower()]
        rows.sort(key=lambda row: row.get("created_at"), reverse=True)
        total = len(rows)
        rows = rows[(page - 1) * page_size:page * page_size]
    else:
        try:
            where, params = _where_clause(query, status)
            count = core.fetchone(f"SELECT count(*) AS count FROM plaud_meetings m{where}", tuple(params)) or {"count": 0}
            total = int(count["count"])
            rows = core.fetchall(
                f"""SELECT m.*, COALESCE(u.name,u.username,'임직원') AS created_by_name
                    FROM plaud_meetings m LEFT JOIN users u ON u.id=m.created_by
                    {where} ORDER BY m.created_at DESC LIMIT %s OFFSET %s""",
                tuple(params + [page_size, (page - 1) * page_size]),
            )
        except Exception as exc:
            logger.exception("PLAUD meeting list DB query failed")
            raise core.AppError("회의록 DB 조회 단계에서 오류가 발생했습니다. 스키마 상태를 확인해 주세요.", 500) from exc
    return {"items": [public_meeting(row, actor) for row in rows], "total": total, "page": page, "page_size": page_size}


def stats():
    if not core.DB_ENABLED:
        values = list(_memory_meetings.values())
        counts = {key: sum(1 for row in values if row.get("status") == key) for key in ("completed", "processing", "failed")}
        return {"total": len(values), **counts}
    try:
        row = core.fetchone(
            """SELECT count(*) AS total,
                      count(*) FILTER (WHERE status='completed') AS completed,
                      count(*) FILTER (WHERE status='processing') AS processing,
                      count(*) FILTER (WHERE status='failed') AS failed
               FROM plaud_meetings"""
        ) or {}
        return {key: int(row.get(key) or 0) for key in ("total", "completed", "processing", "failed")}
    except Exception as exc:
        logger.exception("PLAUD meeting stats DB query failed")
        raise core.AppError("회의록 통계 DB 조회 단계에서 오류가 발생했습니다. 스키마 상태를 확인해 주세요.", 500) from exc

def _find_meeting(meeting_id):
    if not core.DB_ENABLED:
        return _memory_meetings.get(str(meeting_id))
    return core.fetchone(
        """SELECT m.*, COALESCE(u.name,u.username,'임직원') AS created_by_name
           FROM plaud_meetings m LEFT JOIN users u ON u.id=m.created_by WHERE m.id=%s""",
        (str(meeting_id),),
    )


def get_meeting(meeting_id, actor):
    row = _find_meeting(meeting_id)
    if not row:
        raise core.AppError("회의록을 찾을 수 없습니다.", 404)
    return public_meeting(row, actor, detail=True)


def _update_task(row):
    credentials = _credentials()
    result = _http_json(
        "GET",
        f"/developer/api/open/partner/ai/transcriptions/{urlparse.quote(str(row['plaud_transcription_id']))}",
        headers={"X-Client-Id": credentials["client_id"], "X-Client-Api-Key": credentials["api_key"]},
        stage="PLAUD 전사 상태 동기화",
    )
    plaud_status = str(result.get("status") or "PENDING").upper()
    status = "processing"
    data = result.get("data") or {}
    transcript = None
    segments = None
    language = None
    duration = None
    error_message = None
    completed_at = None
    if plaud_status == "SUCCESS":
        status = "completed"
        transcript = str(data.get("text") or "")
        segments = data.get("results") or data.get("segments") or []
        language = data.get("language")
        duration = data.get("duration") or 0
        completed_at = datetime.now(timezone.utc)
    elif plaud_status in PLAUD_FAILED_STATUSES:
        status = "failed"
        error_message = str(result.get("message") or data.get("message") or "PLAUD 전사 처리에 실패했습니다.")[:1000]
        completed_at = datetime.now(timezone.utc)
    if core.DB_ENABLED:
        core.execute(
            """UPDATE plaud_meetings SET status=%s,plaud_status=%s,
                 transcript=COALESCE(%s,transcript),transcript_segments=COALESCE(%s::jsonb,transcript_segments),
                 language=COALESCE(%s,language),duration_seconds=COALESCE(%s,duration_seconds),
                 error_message=%s,completed_at=COALESCE(%s,completed_at),updated_at=now()
               WHERE id=%s RETURNING id""",
            (
                status, plaud_status, transcript,
                json.dumps(segments, ensure_ascii=False) if segments is not None else None,
                language, duration, error_message, completed_at, str(row["id"]),
            ),
        )
    else:
        target = _memory_meetings[str(row["id"])]
        target.update({"status": status, "plaud_status": plaud_status, "updated_at": datetime.now(timezone.utc)})
        if transcript is not None:
            target.update({"transcript": transcript, "transcript_segments": segments, "language": language, "duration_seconds": duration, "completed_at": completed_at})
        if error_message:
            target.update({"error_message": error_message, "completed_at": completed_at})


def sync_meetings(limit=5):
    _require_configured()
    limit = _bounded_int(limit, 5, 1, 10)
    if core.DB_ENABLED:
        rows = core.fetchall(
            "SELECT * FROM plaud_meetings WHERE status='processing' ORDER BY updated_at ASC LIMIT %s",
            (limit,),
        )
    else:
        rows = [row for row in _memory_meetings.values() if row.get("status") == "processing"][:limit]
    synced = 0
    for row in rows:
        try:
            _update_task(row)
            synced += 1
        except core.AppError as exc:
            logger.warning("PLAUD transcription sync skipped meeting_id=%s error=%s", str(row.get("id")), str(exc))
            continue
        except Exception:
            logger.exception("PLAUD transcription sync failed meeting_id=%s", str(row.get("id")))
            continue
    return {"synced": synced, "remaining": stats()["processing"]}
