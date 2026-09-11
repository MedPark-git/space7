"""Runtime patch for MedPark One menu links.

This module is imported automatically by Python's site initialization when the
project root is on sys.path. It patches portal_core before app.py registers its
routes, so the OpenAI meeting menu always resolves to the dedicated space_06
site regardless of which application entrypoint Cafe24 starts.
"""

try:
    import portal_core as core

    _MEETING_URL = "https://medprk-medpark-meeting.mycafe24.ai/"
    _original_menu_config = core.menu_config

    def _menu_config_with_meeting_link():
        config = _original_menu_config()
        urls = dict(config.get("urls") or {})
        urls["meetings_openai"] = _MEETING_URL
        config["urls"] = urls
        return config

    core.menu_config = _menu_config_with_meeting_link
except Exception:
    # Never block application startup because of this compatibility patch.
    pass
