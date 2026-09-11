from app import app
import portal_core as core

# Always provide the MedPark Meeting (space_06) URL when the OpenAI meeting
# menu has no URL configured in the portal DB. Existing explicit admin URLs
# still take precedence so the menu remains configurable later.
_ORIGINAL_MENU_CONFIG = core.menu_config
_MEETING_OPENAI_URL = "https://medprk-medpark-meeting.mycafe24.ai/"


def _menu_config_with_meeting_fallback():
    config = _ORIGINAL_MENU_CONFIG()
    urls = dict(config.get("urls") or {})
    if not str(urls.get("meetings_openai") or "").strip():
        urls["meetings_openai"] = _MEETING_OPENAI_URL
    config["urls"] = urls
    return config


core.menu_config = _menu_config_with_meeting_fallback
