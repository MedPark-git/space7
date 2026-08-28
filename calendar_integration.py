import base64
import hashlib
import html
import json
import logging
import os
import re
import secrets
import threading
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet, InvalidToken

import portal_core as core


logger = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
SEOUL = ZoneInfo("Asia/Seoul")
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

_schema_lock = threading.Lock()
_schema_ready = False


def _plain_text(value):
    raw = str(value or "")
    if not raw:
        return ""
    text = re.sub(r"<(script|style)\b[^>]*>.*?</\1\s*>", "", raw, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<br\s*/?\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</(?:p|div|li|ul|ol|h[1-6]|tr)\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<li\b[^>]*>", "• ", text, flags=re.IGNORECASE)
    text = re.sub(r"<td\b[^>]*>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text).replace("\xa0", " ")
    lines = []
    for line in text.splitlines():
        cleaned = re.sub(r"[ \t]+", " ", line).strip()
        if cleaned:
            lines.append(cleaned)
        elif lines and lines[-1] != "":
            lines.append("")
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


SCHEMA = """
CREATE TABLE IF NOT EXISTS portal_calendar_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  mode varchar(20) NOT NULL DEFAULT 'api_key',
  calendar_id varchar(255) NOT NULL DEFAULT 'medpark.remote@gmail.com',
  api_key_cipher text,
  oauth_client_id text,
  oauth_client_secret_cipher text,
  oauth_refresh_token_cipher text,
  selected_calendars jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS portal_calendar_oauth_states (
  state_hash char(64) PRIMARY KEY,
  admin_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calendar_oauth_states_expires
  ON portal_calendar_oauth_states(expires_at);
INSERT INTO portal_calendar_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
"""


class CalendarError(core.AppError):
    pass


def ensure_schema():
    global _schema_ready
    if _schema_ready:
        return
    core.ensure_database_ready()
    with _schema_lock:
        if _schema_ready:
            return
        with core.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SET LOCAL lock_timeout = '10000ms'")
                cur.execute("SET LOCAL statement_timeout = '30000ms'")
                cur.execute(SCHEMA)
        _schema_ready = True


def _fernet():
    database_secret = os.environ.get("DB_PASSWORD")
    if not database_secret:
        raise CalendarError("캘린더 보안 키를 구성할 수 없습니다.", 503)
    material = hashlib.sha256(
        ("medpark-one/calendar-credentials/v1:" + database_secret).encode("utf-8")
    ).digest()
    return Fernet(base64.urlsafe_b64encode(material))


def _encrypt(value):
    text = str(value or "").strip()
    return _fernet().encrypt(text.encode("utf-8")).decode("ascii") if text else None


def _decrypt(value):
    if not value:
        return ""
    try:
        return _fernet().decrypt(str(value).encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError) as error:
        logger.exception("Calendar credential decryption failed")
        raise CalendarError("저장된 캘린더 인증정보를 해독할 수 없습니다. 관리자 설정을 다시 저장해 주세요.", 503) from error


def _settings(conn=None):
    ensure_schema()
    row = core.fetchone("SELECT * FROM portal_calendar_settings WHERE id=1", conn=conn)
    if not row:
        raise CalendarError("캘린더 설정을 불러오지 못했습니다.", 503)
    selected = row.get("selected_calendars") or []
    if isinstance(selected, str):
        try:
            selected = json.loads(selected)
        except json.JSONDecodeError:
            selected = []
    row["selected_calendars"] = selected if isinstance(selected, list) else []
    return row


def settings_payload(redirect_uri):
    row = _settings()
    mode = row.get("mode") or "api_key"
    api_key_saved = bool(row.get("api_key_cipher"))
    oauth_secret_saved = bool(row.get("oauth_client_secret_cipher"))
    oauth_connected = bool(row.get("oauth_refresh_token_cipher"))
    configured = (
        bool(row.get("calendar_id")) and api_key_saved
        if mode == "api_key"
        else bool(row.get("oauth_client_id")) and oauth_secret_saved
    )
    return {
        "mode": mode,
        "calendar_id": row.get("calendar_id") or "medpark.remote@gmail.com",
        "api_key_saved": api_key_saved,
        "oauth_client_id": row.get("oauth_client_id") or "",
        "oauth_client_secret_saved": oauth_secret_saved,
        "selected_calendars": row.get("selected_calendars") or [],
        "redirect_uri": redirect_uri,
        "configured": configured,
        "connected": api_key_saved if mode == "api_key" else oauth_connected,
    }


def update_settings(data, actor, ip, redirect_uri):
    data = data if isinstance(data, dict) else {}
    mode = str(data.get("mode") or "api_key").strip()
    calendar_id = str(data.get("calendar_id") or "").strip()
    if mode not in ("api_key", "oauth"):
        raise CalendarError("지원하지 않는 캘린더 연결 방식입니다.")
    if not calendar_id or len(calendar_id) > 255:
        raise CalendarError("Google 캘린더 ID를 확인해 주세요.")

    current = _settings()
    api_key_cipher = current.get("api_key_cipher")
    oauth_secret_cipher = current.get("oauth_client_secret_cipher")
    refresh_cipher = current.get("oauth_refresh_token_cipher")
    selected = current.get("selected_calendars") or []

    api_key = str(data.get("api_key") or "").strip()
    oauth_client_id = str(data.get("oauth_client_id") or "").strip()
    oauth_client_secret = str(data.get("oauth_client_secret") or "").strip()
    if len(oauth_client_id) > 500:
        raise CalendarError("OAuth Client ID가 너무 깁니다.")

    if api_key:
        if len(api_key) > 500:
            raise CalendarError("Calendar API 키가 너무 깁니다.")
        api_key_cipher = _encrypt(api_key)
    if oauth_client_secret:
        if len(oauth_client_secret) > 1000:
            raise CalendarError("OAuth Client Secret이 너무 깁니다.")
        oauth_secret_cipher = _encrypt(oauth_client_secret)

    oauth_identity_changed = (
        oauth_client_id != str(current.get("oauth_client_id") or "")
        or bool(oauth_client_secret)
    )
    if oauth_identity_changed:
        refresh_cipher = None
        selected = []

    core.execute(
        """
        UPDATE portal_calendar_settings
           SET mode=%s, calendar_id=%s, api_key_cipher=%s,
               oauth_client_id=%s, oauth_client_secret_cipher=%s,
               oauth_refresh_token_cipher=%s, selected_calendars=%s::jsonb,
               updated_by=%s, updated_at=now()
         WHERE id=1
        """,
        (
            mode,
            calendar_id,
            api_key_cipher,
            oauth_client_id or None,
            oauth_secret_cipher,
            refresh_cipher,
            json.dumps(selected, ensure_ascii=False),
            actor["id"],
        ),
    )
    core.write_audit(
        actor["id"],
        "calendar.settings.update",
        "calendar_settings",
        "1",
        {"mode": mode, "calendar_id": calendar_id, "oauth_identity_changed": oauth_identity_changed},
        ip,
    )
    return settings_payload(redirect_uri)


def _google_error(payload, fallback="Google Calendar 요청에 실패했습니다."):
    try:
        if isinstance(payload, (bytes, bytearray)):
            payload = json.loads(payload.decode("utf-8"))
        detail = payload.get("error")
        if isinstance(detail, dict):
            detail = detail.get("message")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
    except (UnicodeDecodeError, ValueError, AttributeError):
        pass
    return fallback


def _http_json(request, fallback):
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raw = error.read()
        raise CalendarError(_google_error(raw, fallback), 502) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise CalendarError("Google 서버에 연결할 수 없습니다.", 502) from error
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise CalendarError("Google 응답 형식을 확인할 수 없습니다.", 502) from error


def _google_get(path, *, params=None, access_token=None):
    headers = {"accept": "application/json"}
    if access_token:
        headers["authorization"] = f"Bearer {access_token}"
    query = urlencode(params or {}, doseq=True)
    url = f"{GOOGLE_CALENDAR_API}{path}" + (f"?{query}" if query else "")
    request = urllib.request.Request(url, headers=headers, method="GET")
    return _http_json(request, "Google Calendar 요청에 실패했습니다.")


def _token_request(data):
    body = urlencode(data).encode("utf-8")
    request = urllib.request.Request(
        GOOGLE_TOKEN_URL,
        data=body,
        headers={
            "accept": "application/json",
            "content-type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    return _http_json(request, "Google OAuth 인증에 실패했습니다.")


def _oauth_access_token(row=None):
    row = row or _settings()
    refresh_token = _decrypt(row.get("oauth_refresh_token_cipher"))
    client_secret = _decrypt(row.get("oauth_client_secret_cipher"))
    client_id = str(row.get("oauth_client_id") or "")
    if not client_id or not client_secret or not refresh_token:
        raise CalendarError("Google 계정 승인이 필요합니다.", 409)
    token = _token_request(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    )
    access_token = str(token.get("access_token") or "")
    if not access_token:
        raise CalendarError("Google OAuth 액세스 토큰을 받지 못했습니다.", 502)
    return access_token


def start_oauth(actor, redirect_uri, ip):
    row = _settings()
    if row.get("mode") != "oauth":
        raise CalendarError("연결 방식을 OAuth 2.0으로 저장한 후 승인해 주세요.")
    client_id = str(row.get("oauth_client_id") or "")
    client_secret = _decrypt(row.get("oauth_client_secret_cipher"))
    if not client_id or not client_secret:
        raise CalendarError("OAuth Client ID와 Client Secret을 먼저 저장해 주세요.")

    state = secrets.token_urlsafe(32)
    state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
    ensure_schema()
    with core.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM portal_calendar_oauth_states WHERE expires_at <= now()")
            cur.execute(
                "INSERT INTO portal_calendar_oauth_states(state_hash,admin_user_id,redirect_uri,expires_at) VALUES(%s,%s,%s,now()+interval '10 minutes')",
                (state_hash, actor["id"], redirect_uri),
            )
    authorization_url = GOOGLE_AUTH_URL + "?" + urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": GOOGLE_CALENDAR_SCOPE,
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
            "state": state,
        }
    )
    core.write_audit(
        actor["id"],
        "calendar.oauth.start",
        "calendar_settings",
        "1",
        {},
        ip,
    )
    return {"authorization_url": authorization_url}


def finish_oauth(code, state, oauth_error=None, ip=None):
    if not state:
        raise CalendarError("Google OAuth 상태값이 없습니다.", 400)
    state_hash = hashlib.sha256(str(state).encode("utf-8")).hexdigest()
    ensure_schema()
    with core.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM portal_calendar_oauth_states
                 WHERE state_hash=%s AND expires_at>now()
                RETURNING admin_user_id::text, redirect_uri
                """,
                (state_hash,),
            )
            state_row = cur.fetchone()
    if not state_row:
        raise CalendarError("Google OAuth 요청이 만료되었거나 유효하지 않습니다.", 400)
    actor_id, redirect_uri = state_row
    if oauth_error:
        core.write_audit(
            actor_id,
            "calendar.oauth.cancelled",
            "calendar_settings",
            "1",
            {"reason": str(oauth_error)[:100]},
            ip,
        )
        return {"connected": False, "cancelled": True}
    if not code:
        raise CalendarError("Google OAuth 인증 코드가 없습니다.", 400)

    row = _settings()
    client_id = str(row.get("oauth_client_id") or "")
    client_secret = _decrypt(row.get("oauth_client_secret_cipher"))
    token = _token_request(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    )
    refresh_token = str(token.get("refresh_token") or "")
    refresh_cipher = _encrypt(refresh_token) if refresh_token else row.get("oauth_refresh_token_cipher")
    if not refresh_cipher:
        raise CalendarError("Google Refresh Token을 받지 못했습니다. Google 계정 승인을 다시 진행해 주세요.", 502)
    core.execute(
        "UPDATE portal_calendar_settings SET oauth_refresh_token_cipher=%s,updated_by=%s,updated_at=now() WHERE id=1",
        (refresh_cipher, actor_id),
    )
    core.write_audit(
        actor_id,
        "calendar.oauth.connected",
        "calendar_settings",
        "1",
        {},
        ip,
    )
    return {"connected": True}


def _calendar_list(row=None):
    row = row or _settings()
    access_token = _oauth_access_token(row)
    selected_ids = {
        str(item.get("calendar_id"))
        for item in (row.get("selected_calendars") or [])
        if isinstance(item, dict) and item.get("calendar_id")
    }
    calendars = []
    page_token = None
    for _ in range(10):
        params = {"maxResults": 250, "showHidden": "false"}
        if page_token:
            params["pageToken"] = page_token
        result = _google_get("/users/me/calendarList", params=params, access_token=access_token)
        for item in result.get("items") or []:
            calendar_id = str(item.get("id") or "")
            if not calendar_id:
                continue
            calendars.append(
                {
                    "calendar_id": calendar_id,
                    "summary": item.get("summaryOverride") or item.get("summary") or calendar_id,
                    "primary_calendar": bool(item.get("primary")),
                    "access_role": item.get("accessRole") or "reader",
                    "background_color": item.get("backgroundColor") or "#0a9b7e",
                    "foreground_color": item.get("foregroundColor") or "#ffffff",
                    "selected": calendar_id in selected_ids,
                }
            )
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    calendars.sort(key=lambda item: (not item["primary_calendar"], str(item["summary"]).lower()))
    return calendars


def list_calendars():
    row = _settings()
    if row.get("mode") != "oauth":
        raise CalendarError("캘린더 목록은 OAuth 2.0 연결에서 사용할 수 있습니다.")
    return {"calendars": _calendar_list(row)}


def save_selected_calendars(data, actor, ip):
    ids = data.get("calendar_ids") if isinstance(data, dict) else None
    if not isinstance(ids, list):
        raise CalendarError("저장할 캘린더를 선택해 주세요.")
    normalized = list(dict.fromkeys(str(value).strip() for value in ids if str(value).strip()))
    if not normalized or len(normalized) > 50:
        raise CalendarError("캘린더는 1~50개까지 선택할 수 있습니다.")
    available = _calendar_list()
    available_by_id = {item["calendar_id"]: item for item in available}
    if any(value not in available_by_id for value in normalized):
        raise CalendarError("선택한 캘린더 목록이 변경되었습니다. 목록을 다시 불러와 주세요.", 409)
    selected = [{**available_by_id[value], "selected": True} for value in normalized]
    core.execute(
        "UPDATE portal_calendar_settings SET selected_calendars=%s::jsonb,updated_by=%s,updated_at=now() WHERE id=1",
        (json.dumps(selected, ensure_ascii=False), actor["id"]),
    )
    core.write_audit(
        actor["id"],
        "calendar.selection.update",
        "calendar_settings",
        "1",
        {"calendar_count": len(selected)},
        ip,
    )
    return {"selected_calendars": selected}


def test_connection():
    row = _settings()
    if row.get("mode") == "oauth":
        access_token = _oauth_access_token(row)
        _google_get("/users/me/calendarList", params={"maxResults": 1}, access_token=access_token)
        return {"connected": True, "message": "Google Calendar OAuth 연결이 정상입니다."}
    api_key = _decrypt(row.get("api_key_cipher"))
    calendar_id = str(row.get("calendar_id") or "")
    if not api_key or not calendar_id:
        raise CalendarError("Calendar API 키와 캘린더 ID를 먼저 저장해 주세요.")
    now = datetime.now(timezone.utc)
    _google_get(
        f"/calendars/{quote(calendar_id, safe='')}/events",
        params={
            "key": api_key,
            "timeMin": now.isoformat().replace("+00:00", "Z"),
            "timeMax": (now + timedelta(days=7)).isoformat().replace("+00:00", "Z"),
            "singleEvents": "true",
            "maxResults": 1,
        },
    )
    return {"connected": True, "message": "공개 Google Calendar API 연결이 정상입니다."}


def _month_range(month):
    value = str(month or "").strip()
    if not value:
        value = datetime.now(SEOUL).strftime("%Y-%m")
    if not MONTH_RE.match(value):
        raise CalendarError("조회할 월 형식이 올바르지 않습니다.")
    year, month_number = (int(part) for part in value.split("-"))
    start = datetime(year, month_number, 1, tzinfo=SEOUL)
    end = datetime(year + 1, 1, 1, tzinfo=SEOUL) if month_number == 12 else datetime(year, month_number + 1, 1, tzinfo=SEOUL)
    return start, end


def _events_for_calendar(calendar, row, start, end, access_token=None):
    calendar_id = calendar["calendar_id"]
    params = {
        "timeMin": start.isoformat(),
        "timeMax": end.isoformat(),
        "singleEvents": "true",
        "orderBy": "startTime",
        "maxResults": 2500,
        "timeZone": "Asia/Seoul",
    }
    if row.get("mode") == "api_key":
        params["key"] = _decrypt(row.get("api_key_cipher"))
    events = []
    page_token = None
    for _ in range(10):
        if page_token:
            params["pageToken"] = page_token
        result = _google_get(
            f"/calendars/{quote(calendar_id, safe='')}/events",
            params=params,
            access_token=access_token,
        )
        for item in result.get("items") or []:
            event_start = item.get("start") or {}
            event_end = item.get("end") or {}
            start_value = event_start.get("dateTime") or event_start.get("date")
            if not start_value:
                continue
            events.append(
                {
                    "id": str(item.get("id") or ""),
                    "title": item.get("summary") or "(제목 없음)",
                    "start": start_value,
                    "end": event_end.get("dateTime") or event_end.get("date"),
                    "all_day": bool(event_start.get("date")),
                    "calendar_id": calendar_id,
                    "calendar_name": calendar.get("summary") or calendar_id,
                    "calendar_color": calendar.get("background_color") or "#0a9b7e",
                    "calendar_foreground": calendar.get("foreground_color") or "#ffffff",
                    "description": _plain_text(item.get("description")),
                    "location": item.get("location") or "",
                }
            )
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    return events


def list_events(month):
    row = _settings()
    start, end = _month_range(month)
    mode = row.get("mode") or "api_key"
    if mode == "oauth":
        configured = bool(row.get("oauth_refresh_token_cipher"))
        calendars = row.get("selected_calendars") or []
        if not calendars:
            calendars = [{"calendar_id": row.get("calendar_id") or "primary", "summary": row.get("calendar_id") or "기본 캘린더"}]
        access_token = _oauth_access_token(row) if configured else None
    else:
        configured = bool(row.get("api_key_cipher")) and bool(row.get("calendar_id"))
        calendars = [{"calendar_id": row.get("calendar_id") or "", "summary": row.get("calendar_id") or "Google Calendar"}]
        access_token = None
    if not configured:
        return {
            "connected": False,
            "calendar_count": 0,
            "events": [],
            "warnings": [],
            "message": "관리자 메뉴에서 Google Calendar 연결 설정이 필요합니다.",
        }

    events, warnings = [], []
    for calendar in calendars[:50]:
        try:
            events.extend(_events_for_calendar(calendar, row, start, end, access_token))
        except CalendarError as error:
            logger.warning("Calendar fetch failed for %s: %s", calendar.get("calendar_id"), error)
            warnings.append(f"{calendar.get('summary') or calendar.get('calendar_id')}: {error}")
    events.sort(key=lambda item: (str(item.get("start") or ""), str(item.get("title") or "")))
    return {
        "connected": len(warnings) < len(calendars),
        "calendar_count": len(calendars),
        "events": events,
        "warnings": warnings,
        "message": "일정을 불러왔습니다." if len(warnings) < len(calendars) else "Google Calendar 일정을 불러오지 못했습니다.",
    }
