from pathlib import Path

from flask import Response, redirect

from app import app
import portal_core as core


MEETING_OPENAI_URL = "https://medprk-medpark-meeting.mycafe24.ai/"
ROOT = Path(__file__).resolve().parent
INDEX_HTML = ROOT / "public" / "index.html"

# 1) API/DB 값과 무관하게 회의록_OpenAI 메뉴 URL을 space_06으로 고정한다.
_original_menu_config = core.menu_config


def _forced_menu_config():
    config = _original_menu_config()
    urls = dict(config.get("urls") or {})
    urls["meetings_openai"] = MEETING_OPENAI_URL
    config["urls"] = urls
    return config


core.menu_config = _forced_menu_config


# 2) 실제 홈 HTML에 직접 스크립트를 삽입한다.
# app.py의 send_from_directory 응답 후처리가 아니라 이 view 자체가 HTML을 반환하므로
# 브라우저에 반드시 아래 스크립트가 전달된다.
_MEETING_LINK_SCRIPT = r'''
<script id="medpark-meeting-openai-direct-link">
(function () {
  const meetingUrl = "https://medprk-medpark-meeting.mycafe24.ai/";

  function convertMeetingMenuToLink() {
    const nav = document.getElementById("mainNav");
    if (!nav) return;

    nav.querySelectorAll('button[data-sub-page="meetings_openai"]').forEach(function (button) {
      const link = document.createElement("a");
      link.href = meetingUrl;
      link.rel = "noopener noreferrer";
      link.className = button.className || "";
      link.innerHTML = button.innerHTML;
      link.setAttribute("data-external", "회의록_OpenAI_(예정)");
      link.setAttribute("data-url", meetingUrl);
      link.setAttribute("aria-label", "회의록_OpenAI_(예정) 연결 사이트 열기");
      const arrow = link.querySelector("b");
      if (arrow) arrow.textContent = "↗";
      button.replaceWith(link);
    });

    nav.querySelectorAll('a[data-external^="회의록_OpenAI"]').forEach(function (link) {
      link.href = meetingUrl;
      link.removeAttribute("target");
      link.rel = "noopener noreferrer";
      link.setAttribute("data-url", meetingUrl);
      const arrow = link.querySelector("b");
      if (arrow) arrow.textContent = "↗";
    });
  }

  function start() {
    const nav = document.getElementById("mainNav");
    if (!nav) return;
    convertMeetingMenuToLink();
    new MutationObserver(convertMeetingMenuToLink).observe(nav, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
</script>
'''


def _index_with_direct_meeting_link():
    html = INDEX_HTML.read_text(encoding="utf-8")
    if "medpark-meeting-openai-direct-link" not in html:
        html = html.replace("</body>", _MEETING_LINK_SCRIPT + "\n</body>", 1)
    response = Response(html, mimetype="text/html")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


app.view_functions["index"] = _index_with_direct_meeting_link


# 직접 확인/우회용 주소. 접속 시 space_06으로 즉시 이동한다.
@app.get("/meeting-openai-link")
def meeting_openai_link_bridge():
    return redirect(MEETING_OPENAI_URL, code=302)
