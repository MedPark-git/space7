from app import app
import portal_core as core
from flask import request

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


# Final safety net: force the sidebar OpenAI meeting menu to behave as a real
# hyperlink even if an older cached/API menu config still renders it as an
# internal placeholder button. Capture-phase handling runs before app.js.
_MEETING_LINK_FIX = r'''
<script>
document.addEventListener("click", function (event) {
  var target = event.target.closest('[data-sub-page="meetings_openai"], a[data-external^="회의록_OpenAI"]');
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  window.open("https://medprk-medpark-meeting.mycafe24.ai/", "_blank", "noopener,noreferrer");
}, true);
</script>
'''


@app.after_request
def _inject_meeting_openai_hyperlink(response):
    try:
        if request.path == "/" and response.status_code == 200 and response.mimetype == "text/html":
            html = response.get_data(as_text=True)
            if "data-sub-page=\"meetings_openai\"" not in html and "</body>" in html:
                html = html.replace("</body>", _MEETING_LINK_FIX + "</body>", 1)
                response.set_data(html)
                response.content_length = len(response.get_data())
                response.headers["Cache-Control"] = "no-store, max-age=0"
    except Exception:
        pass
    return response
