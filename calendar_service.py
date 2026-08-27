import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode

import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import portal_core as core

CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
CALENDAR_REDIRECT_URI = os.environ.get(
    "GOOGLE_CALENDAR_REDIRECT_URI",
    "https://medprk-medpark-one.mycafe24.ai/api/calendar/oauth/callback",
)
_cache = {}


def _b64encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _b64decode(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _key():
    source = os.environ.get("CALENDAR_SETTINGS_SECRET") or os.environ.get("DB_PASSWORD") or "medpark-one-local-calendar-key"
    return hashlib.sha256(source.encode()).digest()


def encrypt_secret(value):
    if not value:
        return None
    iv = secrets.token_bytes(12)
    encrypted = AESGCM(_key()).encrypt(iv, str(value).encode(), None)
    ciphertext, tag = encrypted[:-16], encrypted[-16:]
    return ".".join((_b64encode(iv), _b64encode(tag), _b64encode(ciphertext)))


def decrypt_secret(encoded):
    if not encoded:
        return None
    try:
        iv, tag, ciphertext = (_b64decode(part) for part in str(encoded).split("."))
        return AESGCM(_key()).decrypt(iv, ciphertext + tag, None).decode()
    except Exception:
        return None


def settings_row():
    if core.DB_ENABLED:
        return core.fetchone("SELECT * FROM calendar_integration_settings WHERE id=1")
    return core._memory["calendar"]


def selected_calendars(row=None):
    if core.DB_ENABLED:
        selected = core.fetchall("SELECT calendar_id,summary,background_color,foreground_color,primary_calendar,access_role,item_order FROM calendar_integration_calendars ORDER BY item_order,summary")
    else:
        selected = sorted(core._memory["calendars"].values(), key=lambda item: item["item_order"])
    if selected:
        return selected
    row = row or settings_row()
    if row and row.get("calendar_id"):
        return [{"calendar_id": row["calendar_id"], "summary": row["calendar_id"], "background_color": None, "foreground_color": "#ffffff", "primary_calendar": True, "access_role": None, "item_order": 0}]
    return []


def public_settings(row):
    return {
        "configured": bool(row), "mode": (row or {}).get("mode", "api_key"),
        "calendar_id": (row or {}).get("calendar_id", "medpark.remote@gmail.com"),
        "api_key_saved": bool((row or {}).get("api_key_encrypted")),
        "oauth_client_id": (row or {}).get("oauth_client_id") or "",
        "oauth_client_secret_saved": bool((row or {}).get("oauth_client_secret_encrypted")),
        "connected": bool((row or {}).get("api_key_encrypted")) if (row or {}).get("mode") != "oauth" else bool((row or {}).get("refresh_token_encrypted") or (row or {}).get("access_token_encrypted")),
        "redirect_uri": CALENDAR_REDIRECT_URI, "scope": CALENDAR_SCOPE,
        "updated_at": core.iso((row or {}).get("updated_at")),
        "selected_calendars": selected_calendars(row) if (row or {}).get("mode") == "oauth" else [],
    }


def save_settings(data, actor, ip):
    existing = settings_row() or {}
    mode = "oauth" if data.get("mode") == "oauth" else "api_key"
    calendar_id = str(data.get("calendar_id") or "").strip()
    api_key = str(data.get("api_key") or "").strip()
    client_id = str(data.get("oauth_client_id") or "").strip()
    client_secret = str(data.get("oauth_client_secret") or "").strip()
    if not calendar_id or len(calendar_id) > 255:
        raise core.AppError("Google 캘린더 ID를 입력해 주세요.")
    if mode == "api_key" and not api_key and not existing.get("api_key_encrypted"):
        raise core.AppError("Google Calendar API 키를 입력해 주세요.")
    if mode == "oauth" and (not client_id or (not client_secret and not existing.get("oauth_client_secret_encrypted"))):
        raise core.AppError("OAuth 2.0 Client ID와 Client Secret을 모두 입력해 주세요.")
    same_mode = mode == existing.get("mode")
    row = {
        "id": 1, "mode": mode, "calendar_id": calendar_id,
        "api_key_encrypted": encrypt_secret(api_key) if api_key else existing.get("api_key_encrypted"),
        "oauth_client_id": client_id or existing.get("oauth_client_id"),
        "oauth_client_secret_encrypted": encrypt_secret(client_secret) if client_secret else existing.get("oauth_client_secret_encrypted"),
        "access_token_encrypted": existing.get("access_token_encrypted") if same_mode else None,
        "refresh_token_encrypted": existing.get("refresh_token_encrypted") if same_mode else None,
        "token_expiry": existing.get("token_expiry") if same_mode else None,
        "oauth_state_hash": None, "oauth_state_expiry": None, "updated_by": actor["id"],
    }
    if core.DB_ENABLED:
        core.execute("""INSERT INTO calendar_integration_settings
          (id,mode,calendar_id,api_key_encrypted,oauth_client_id,oauth_client_secret_encrypted,access_token_encrypted,refresh_token_encrypted,token_expiry,oauth_state_hash,oauth_state_expiry,updated_by,updated_at)
          VALUES(1,%s,%s,%s,%s,%s,%s,%s,%s,NULL,NULL,%s,now()) ON CONFLICT(id) DO UPDATE SET
          mode=excluded.mode,calendar_id=excluded.calendar_id,api_key_encrypted=excluded.api_key_encrypted,
          oauth_client_id=excluded.oauth_client_id,oauth_client_secret_encrypted=excluded.oauth_client_secret_encrypted,
          access_token_encrypted=excluded.access_token_encrypted,refresh_token_encrypted=excluded.refresh_token_encrypted,
          token_expiry=excluded.token_expiry,oauth_state_hash=NULL,oauth_state_expiry=NULL,updated_by=excluded.updated_by,updated_at=now()""",
          (row["mode"], row["calendar_id"], row["api_key_encrypted"], row["oauth_client_id"], row["oauth_client_secret_encrypted"], row["access_token_encrypted"], row["refresh_token_encrypted"], row["token_expiry"], actor["id"]))
    else:
        row["updated_at"] = datetime.now(timezone.utc)
        core._memory["calendar"] = row
    _cache.clear()
    core.write_audit(actor["id"], "calendar.settings.update", "calendar_integration", "google", {"mode": mode, "calendar_id": calendar_id}, ip)
    return public_settings(settings_row())


def _google_response(response, fallback):
    try:
        detail = response.json().get("error", {}).get("message") or fallback
    except Exception:
        detail = fallback
    raise core.AppError(detail, 400 if 400 <= response.status_code < 500 else 502)


def start_oauth(actor, ip):
    row = settings_row()
    if not row or row.get("mode") != "oauth" or not row.get("oauth_client_id") or not row.get("oauth_client_secret_encrypted"):
        raise core.AppError("OAuth 설정을 먼저 저장해 주세요.")
    state = _b64encode(secrets.token_bytes(32))
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    expiry = datetime.now(timezone.utc) + timedelta(minutes=10)
    if core.DB_ENABLED:
        core.execute("UPDATE calendar_integration_settings SET oauth_state_hash=%s,oauth_state_expiry=%s WHERE id=1", (state_hash, expiry))
    else:
        row.update({"oauth_state_hash": state_hash, "oauth_state_expiry": expiry})
    params = urlencode({"client_id": row["oauth_client_id"], "redirect_uri": CALENDAR_REDIRECT_URI, "response_type": "code", "scope": CALENDAR_SCOPE, "access_type": "offline", "prompt": "consent", "state": state})
    core.write_audit(actor["id"], "calendar.oauth.start", "calendar_integration", "google", {}, ip)
    return {"authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?" + params}


def exchange_code(code, state):
    row = settings_row()
    state_hash = hashlib.sha256(str(state or "").encode()).hexdigest()
    expiry = (row or {}).get("oauth_state_expiry")
    if not row or not row.get("oauth_state_hash") or row["oauth_state_hash"] != state_hash or not expiry or expiry < datetime.now(timezone.utc):
        raise core.AppError("Google 승인 요청이 만료되었거나 올바르지 않습니다.")
    secret = decrypt_secret(row.get("oauth_client_secret_encrypted"))
    if not secret:
        raise core.AppError("OAuth Client Secret을 복호화할 수 없습니다.", 500)
    response = requests.post("https://oauth2.googleapis.com/token", data={"code": str(code or ""), "client_id": row["oauth_client_id"], "client_secret": secret, "redirect_uri": CALENDAR_REDIRECT_URI, "grant_type": "authorization_code"}, timeout=20)
    if not response.ok:
        _google_response(response, "Google OAuth 승인 처리에 실패했습니다.")
    token = response.json()
    access = encrypt_secret(token.get("access_token"))
    refresh = encrypt_secret(token.get("refresh_token")) if token.get("refresh_token") else row.get("refresh_token_encrypted")
    token_expiry = datetime.now(timezone.utc) + timedelta(seconds=int(token.get("expires_in", 3600)))
    if core.DB_ENABLED:
        core.execute("UPDATE calendar_integration_settings SET access_token_encrypted=%s,refresh_token_encrypted=%s,token_expiry=%s,oauth_state_hash=NULL,oauth_state_expiry=NULL,updated_at=now() WHERE id=1", (access, refresh, token_expiry))
    else:
        row.update({"access_token_encrypted": access, "refresh_token_encrypted": refresh, "token_expiry": token_expiry, "oauth_state_hash": None, "oauth_state_expiry": None})
    _cache.clear()


def access_token(row):
    current = decrypt_secret(row.get("access_token_encrypted"))
    expiry = row.get("token_expiry")
    if current and expiry and expiry > datetime.now(timezone.utc) + timedelta(minutes=1):
        return current
    refresh = decrypt_secret(row.get("refresh_token_encrypted"))
    secret = decrypt_secret(row.get("oauth_client_secret_encrypted"))
    if not refresh or not secret:
        raise core.AppError("Google 계정 승인이 필요합니다.")
    response = requests.post("https://oauth2.googleapis.com/token", data={"client_id": row["oauth_client_id"], "client_secret": secret, "refresh_token": refresh, "grant_type": "refresh_token"}, timeout=20)
    if not response.ok:
        _google_response(response, "Google 인증 갱신에 실패했습니다.")
    token = response.json()
    token_expiry = datetime.now(timezone.utc) + timedelta(seconds=int(token.get("expires_in", 3600)))
    encrypted = encrypt_secret(token.get("access_token"))
    if core.DB_ENABLED:
        core.execute("UPDATE calendar_integration_settings SET access_token_encrypted=%s,token_expiry=%s,updated_at=now() WHERE id=1", (encrypted, token_expiry))
    else:
        row.update({"access_token_encrypted": encrypted, "token_expiry": token_expiry})
    return token["access_token"]


def google_calendar_list(row):
    if not row or row.get("mode") != "oauth":
        raise core.AppError("OAuth 2.0 연결 방식을 먼저 선택해 주세요.")
    token = access_token(row)
    calendars, page = [], ""
    while True:
        params = {"maxResults": "250", "minAccessRole": "reader", "showHidden": "true"}
        if page:
            params["pageToken"] = page
        response = requests.get("https://www.googleapis.com/calendar/v3/users/me/calendarList", params=params, headers={"Accept": "application/json", "Authorization": "Bearer " + token}, timeout=20)
        if not response.ok:
            _google_response(response, "Google 캘린더 목록을 불러오지 못했습니다.")
        data = response.json()
        for item in data.get("items", []):
            if not item.get("id"):
                continue
            calendars.append({"calendar_id": str(item["id"]), "summary": str(item.get("summaryOverride") or item.get("summary") or item["id"]), "background_color": item.get("backgroundColor") or "#0a9b7e", "foreground_color": item.get("foregroundColor") or "#ffffff", "primary_calendar": bool(item.get("primary")), "access_role": item.get("accessRole") or "reader"})
        page = data.get("nextPageToken") or ""
        if not page:
            return calendars


def list_available():
    row = settings_row()
    available = google_calendar_list(row)
    selected = {item["calendar_id"] for item in selected_calendars(row)}
    return {"calendars": [{**item, "selected": item["calendar_id"] in selected} for item in available]}


def save_selected(data, actor, ip):
    ids = list(dict.fromkeys(str(value).strip() for value in (data.get("calendar_ids") or []) if str(value).strip()))
    if not ids or len(ids) > 50 or any(len(value) > 255 for value in ids):
        raise core.AppError("캘린더는 1~50개를 선택해 주세요.")
    row = settings_row()
    available = {item["calendar_id"]: item for item in google_calendar_list(row)}
    if any(value not in available for value in ids):
        raise core.AppError("현재 Google 계정에서 조회할 수 없는 캘린더가 포함되어 있습니다.")
    selected = [{**available[value], "item_order": index} for index, value in enumerate(ids)]
    if core.DB_ENABLED:
        with core.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM calendar_integration_calendars")
                for item in selected:
                    cur.execute("INSERT INTO calendar_integration_calendars(calendar_id,summary,background_color,foreground_color,primary_calendar,access_role,item_order,updated_by) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)", (item["calendar_id"], item["summary"], item["background_color"], item["foreground_color"], item["primary_calendar"], item["access_role"], item["item_order"], actor["id"]))
                cur.execute("UPDATE calendar_integration_settings SET calendar_id=%s,updated_by=%s,updated_at=now() WHERE id=1", (selected[0]["calendar_id"], actor["id"]))
    else:
        core._memory["calendars"] = {item["calendar_id"]: item for item in selected}
        if core._memory["calendar"]:
            core._memory["calendar"]["calendar_id"] = selected[0]["calendar_id"]
    _cache.clear()
    core.write_audit(actor["id"], "calendar.selection.update", "calendar_integration", "google", {"calendar_ids": ids}, ip)
    return {"success": True, "selected_calendars": selected}


def _fetch_events(calendar, params, headers):
    events, page = [], ""
    while True:
        request_params = dict(params)
        if page:
            request_params["pageToken"] = page
        response = requests.get(f"https://www.googleapis.com/calendar/v3/calendars/{quote(calendar['calendar_id'], safe='')}/events", params=request_params, headers=headers, timeout=20)
        if not response.ok:
            _google_response(response, f"{calendar['summary']} 일정을 불러오지 못했습니다.")
        data = response.json()
        for item in data.get("items", []):
            if item.get("status") == "cancelled":
                continue
            start, end = item.get("start") or {}, item.get("end") or {}
            events.append({"id": f"{calendar['calendar_id']}:{item.get('id')}", "source_event_id": item.get("id"), "calendar_id": calendar["calendar_id"], "calendar_name": calendar["summary"], "calendar_color": calendar.get("background_color") or "#0a9b7e", "calendar_foreground": calendar.get("foreground_color") or "#ffffff", "title": item.get("summary") or "제목 없는 일정", "start": start.get("dateTime") or start.get("date"), "end": end.get("dateTime") or end.get("date"), "all_day": bool(start.get("date")), "location": item.get("location") or "", "description": item.get("description") or "", "html_link": item.get("htmlLink") or ""})
        page = data.get("nextPageToken") or ""
        if not page:
            return events


def calendar_events(month=None):
    row = settings_row()
    if not row:
        return {"connected": False, "events": [], "message": "관리자가 Google Calendar 연결을 설정해 주세요."}
    now = datetime.now(timezone.utc)
    try:
        year, month_number = [int(value) for value in str(month or now.strftime("%Y-%m")).split("-")]
    except ValueError:
        raise core.AppError("조회 월 형식을 확인해 주세요.")
    if not 2000 <= year <= 2100 or not 1 <= month_number <= 12:
        raise core.AppError("조회 월 형식을 확인해 주세요.")
    calendars = selected_calendars(row) if row.get("mode") == "oauth" else [{"calendar_id": row["calendar_id"], "summary": row["calendar_id"], "background_color": None, "foreground_color": "#ffffff"}]
    key = f"{row['mode']}:{'|'.join(item['calendar_id'] for item in calendars)}:{year}-{month_number}"
    cached = _cache.get(key)
    if cached and cached[0] > datetime.now(timezone.utc):
        return cached[1]
    start = datetime(year, month_number, 1, tzinfo=timezone.utc)
    end = datetime(year + (month_number == 12), 1 if month_number == 12 else month_number + 1, 1, tzinfo=timezone.utc)
    params = {"timeMin": start.isoformat().replace("+00:00", "Z"), "timeMax": end.isoformat().replace("+00:00", "Z"), "singleEvents": "true", "orderBy": "startTime", "maxResults": "250", "timeZone": "Asia/Seoul"}
    headers = {"Accept": "application/json"}
    if row["mode"] == "api_key":
        params["key"] = decrypt_secret(row.get("api_key_encrypted")) or ""
    else:
        headers["Authorization"] = "Bearer " + access_token(row)
    events, warnings = [], []
    for calendar in calendars:
        try:
            events.extend(_fetch_events(calendar, params, headers))
        except Exception as error:
            warnings.append({"calendar_id": calendar["calendar_id"], "calendar_name": calendar["summary"], "message": str(error)})
    if warnings and len(warnings) == len(calendars):
        raise core.AppError(warnings[0]["message"])
    events.sort(key=lambda item: str(item.get("start") or ""))
    value = {"connected": True, "mode": row["mode"], "calendar_id": row["calendar_id"], "calendar_count": len(calendars), "calendars": calendars, "events": events, "warnings": warnings}
    _cache[key] = (datetime.now(timezone.utc) + timedelta(minutes=5), value)
    return value
