from app import app, PUBLIC
import portal_core as core
import plaud_integration as plaud
import plaud_device_registry as device_registry
from flask import Response, redirect

MEETING_OPENAI_URL = "https://medprk-medpark-meeting.mycafe24.ai/"

_original_menu_config = core.menu_config


def _forced_menu_config():
    config = _original_menu_config()
    urls = dict(config.get("urls") or {})
    urls["meetings_openai"] = MEETING_OPENAI_URL
    config["urls"] = urls
    return config


core.menu_config = _forced_menu_config


@app.get("/meeting-openai-link")
def meeting_openai_link():
    return redirect(MEETING_OPENAI_URL, code=302)


FORCE_LINK_JS = r'''
(() => {
  const BRIDGE = "/meeting-openai-link";
  function convertMeetingOpenAiMenu() {
    document.querySelectorAll('[data-sub-page="meetings_openai"]').forEach((button) => {
      if (button.tagName === "A") return;
      const link = document.createElement("a");
      link.className = button.className;
      link.href = BRIDGE;
      link.target = "_self";
      link.setAttribute("data-meeting-openai-direct", "1");
      link.innerHTML = button.innerHTML;
      const arrow = link.querySelector("b:last-child");
      if (arrow) arrow.textContent = "↗";
      button.replaceWith(link);
    });
    document.querySelectorAll('a[data-external^="회의록_OpenAI"]').forEach((link) => {
      link.href = BRIDGE;
      link.target = "_self";
      link.setAttribute("data-meeting-openai-direct", "1");
      const arrow = link.querySelector("b:last-child");
      if (arrow) arrow.textContent = "↗";
    });
  }
  document.addEventListener("click", (event) => {
    const target = event.target.closest('[data-meeting-openai-direct="1"], [data-sub-page="meetings_openai"]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    window.location.assign(BRIDGE);
  }, true);
  const observer = new MutationObserver(convertMeetingOpenAiMenu);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", convertMeetingOpenAiMenu);
  convertMeetingOpenAiMenu();
})();
'''


@app.get("/meeting-openai-force.js")
def meeting_openai_force_js():
    response = Response(FORCE_LINK_JS, mimetype="application/javascript")
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


# Real PLAUD Device Registry APIs.
device_registry.install(app)

_original_plaud_user_id = plaud._plaud_user_id


def _registry_aware_plaud_user_id(user):
    registered = device_registry.partner_user_for_portal_user(user)
    return registered or _original_plaud_user_id(user)


plaud._plaud_user_id = _registry_aware_plaud_user_id


def _patched_index():
    html = (PUBLIC / "index.html").read_text(encoding="utf-8")
    # Force a fresh fetch of the stabilized registry UI while keeping a single load source.
    html = html.replace(
        "plaud-device-registry-ui.js?v=20260911-device-registry2",
        "plaud-device-registry-ui.js?v=20260911-device-registry-stable1",
    )
    marker = '<script src="/meeting-openai-force.js?v=20260911-final-direct-link"></script>'
    if marker not in html:
        html = html.replace("</body>", marker + "\n</body>", 1)
    response = Response(html, mimetype="text/html")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


app.view_functions["index"] = _patched_index
