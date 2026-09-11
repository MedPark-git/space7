from app import app
import portal_core as core

MEETINGS_OPENAI_URL = "https://medprk-medpark-meeting.mycafe24.ai/"
_original_menu_config = core.menu_config


def _menu_config_with_space6_link():
    config = _original_menu_config()
    config.setdefault("urls", {})["meetings_openai"] = MEETINGS_OPENAI_URL
    return config


core.menu_config = _menu_config_with_space6_link
