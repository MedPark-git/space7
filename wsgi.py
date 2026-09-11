from app import app
import portal_core as core
from flask import redirect

# Force the MedPark One OpenAI meeting menu to the dedicated space_06 site.
# This intentionally overrides any stale/legacy value stored in the portal DB.
_MEETING_OPENAI_URL = "https://medprk-medpark-meeting.mycafe24.ai/"
_ORIGINAL_MENU_CONFIG = core.menu_config


def _menu_config_with_forced_meeting_link():
    config = _ORIGINAL_MENU_CONFIG()
    urls = dict(config.get("urls") or {})
    urls["meetings_openai"] = _MEETING_OPENAI_URL
    config["urls"] = urls
    return config


core.menu_config = _menu_config_with_forced_meeting_link


# A direct bridge URL is also kept as a fallback for bookmarks/legacy links.
@app.get("/meeting-openai-link")
def meeting_openai_link_bridge():
    return redirect(_MEETING_OPENAI_URL, code=302)
