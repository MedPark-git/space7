from app import app, PUBLIC
import portal_core as core
from flask import Response, redirect

MEETING_OPENAI_URL = "https://medprk-medpark-meeting.mycafe24.ai/"

# 1) API 메뉴 설정도 항상 space_06 주소를 반환하도록 강제한다.
_original_menu_config = core.menu_config


def _forced_menu_config():
    config = _original_menu_config()
    urls = dict(config.get("urls") or {})
    urls["meetings_openai"] = MEETING_OPENAI_URL
    config["urls"] = urls
    return config


core.menu_config = _forced_menu_config

# 2) 내부 Placeholder 경로 대신 사용할 단순 리다이렉트 브리지.
@app.get("/meeting-openai-link")
def meeting_openai_link():
    return redirect(MEETING_OPENAI_URL, code=302)

# 3) 메뉴가 버튼으로 다시 렌더링되더라도 실제 <a href> 링크로 교체한다.
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

# 4) 실제 운영 HTML에 필요한 보강 스크립트를 주입한다.
def _patched_index():
    html = (PUBLIC / "index.html").read_text(encoding="utf-8")
    markers = [
        '<script src="/meeting-openai-force.js?v=20260911-final-direct-link"></script>',
        '<script src="/plaud-embedded-android.js?v=20260911-android-embedded1" defer></script>',
    ]
    for marker in markers:
        if marker not in html:
            html = html.replace("</body>", marker + "\n</body>", 1)
    response = Response(html, mimetype="text/html")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


app.view_functions["index"] = _patched_index
