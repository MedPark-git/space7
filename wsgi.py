from app import app
import portal_core as core


MEETINGS_OPENAI_URL = "https://medprk-medpark-meeting.mycafe24.ai/"
_original_menu_config = core.menu_config


def _menu_config_with_meetings_openai_link():
    config = _original_menu_config()
    config.setdefault("urls", {})["meetings_openai"] = MEETINGS_OPENAI_URL
    return config


# The MedPark One navigation reads menu URLs from /api/menu.
# Keep the OpenAI meeting-minutes menu bound to the dedicated space_06 site.
core.menu_config = _menu_config_with_meetings_openai_link
