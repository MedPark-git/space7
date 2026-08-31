import base64
import json
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


ALLOWED_FILE_TYPES = {"mp3", "opus"}
MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024
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
    }


def _http_json(method, path, *, headers=None, payload=None, form=None, timeout=20):
    credentials = _credentials()
    body = None
    request_headers = {"Accept": "application/json", **(headers or {})}
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
    try:
        with urlrequest.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urlerror.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            details = json.loads(raw)
            message = details.get("message") or details.get("detail") or details.get("error") or raw
        except (ValueError, AttributeError):
            message = raw
        safe_message = str(message or f"HTTP {exc.code}")[:300]
        raise core.AppError(f"PLAUD API 요청에 실패했습니다. ({safe_message})", 502) from exc
    except (urlerror.URLError, TimeoutError) as exc:
        raise core.AppError("PLAUD 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503) from exc


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
    )
    access_token = result.get("access_token")
    if not access_token:
        raise core.AppError("PLAUD User Token을 발급받지 못했습니다.", 502)
    expires_in = max(120, int(result.get("expires_in") or 86400))
    with _token_lock:
        _token_cache["users"][stable_user_id] = {"access_token": access_token, "expires_at": now + expires_in}
    return access_token


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
    token = _user_token(user["id"])
    result = _http_json(
        "POST",
        "/developer/api/open/partner/files/upload/generate-presigned-urls",
        headers={"Authorization": f"Bearer {token}"},
        payload={"filesize": file_size, "filetype": file_type},
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
        normalized_parts.append({"part_number": part_number, "upload_url": upload_url})
    return {
        "file_id": file_id,
        "upload_id": upload_id,
        "chunk_size": int(chunk_size),
        "file_type": file_type,
        "parts": normalized_parts,
    }


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
    )
    transcription_id = transcription.get("transcription_id")
    plaud_status = str(transcription.get("status") or "PENDING").upper()
    if not transcription_id:
        raise core.AppError("PLAUD 전사 작업을 생성하지 못했습니다.", 502)
    try:
        file_size = max(0, int(data.get("file_size") or 0))
    except (TypeError, ValueError):
        file_size = 0
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
    core.write_audit(user["id"], "plaud.meeting.create", "plaud_meeting", str(row["id"]), {"status": "processing"}, ip)
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
        where, params = _where_clause(query, status)
        count = core.fetchone(f"SELECT count(*) AS count FROM plaud_meetings m{where}", tuple(params)) or {"count": 0}
        total = int(count["count"])
        rows = core.fetchall(
            f"""SELECT m.*, COALESCE(u.name,u.username,'임직원') AS created_by_name
                FROM plaud_meetings m LEFT JOIN users u ON u.id=m.created_by
                {where} ORDER BY m.created_at DESC LIMIT %s OFFSET %s""",
            tuple(params + [page_size, (page - 1) * page_size]),
        )
    return {"items": [public_meeting(row, actor) for row in rows], "total": total, "page": page, "page_size": page_size}


def stats():
    if not core.DB_ENABLED:
        values = list(_memory_meetings.values())
        counts = {key: sum(1 for row in values if row.get("status") == key) for key in ("completed", "processing", "failed")}
        return {"total": len(values), **counts}
    row = core.fetchone(
        """SELECT count(*) AS total,
                  count(*) FILTER (WHERE status='completed') AS completed,
                  count(*) FILTER (WHERE status='processing') AS processing,
                  count(*) FILTER (WHERE status='failed') AS failed
           FROM plaud_meetings"""
    ) or {}
    return {key: int(row.get(key) or 0) for key in ("total", "completed", "processing", "failed")}


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
        except core.AppError:
            continue
    return {"synced": synced, "remaining": stats()["processing"]}
