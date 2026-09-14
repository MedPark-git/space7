(() => {
  if (window.__MEDPARK_PLAUD_USER_SOURCE_FIX__) return;
  window.__MEDPARK_PLAUD_USER_SOURCE_FIX__ = true;

  const PANEL_ID = "plaudDeviceDirectRegistry";
  let users = [];
  let loading = false;
  let timer = null;

  function partnerUserId(user) {
    const email = String(user?.email || "").trim();
    const username = String(user?.username || "").trim();
    if (email.length >= 6) return email.slice(0, 255);
    if (username.length >= 6) return username.slice(0, 255);
    const safe = username.replace(/[^A-Za-z0-9._-]/g, "") || "user";
    return `MPK-${safe}`.slice(0, 255);
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function loadUsers() {
    if (loading) return;
    loading = true;
    try {
      const [adminResult, meResult] = await Promise.allSettled([
        fetchJson("/api/admin/users"),
        fetchJson("/api/auth/me"),
      ]);

      const map = new Map();
      if (adminResult.status === "fulfilled") {
        const list = Array.isArray(adminResult.value?.users) ? adminResult.value.users : [];
        list.filter((user) => user?.status === "active").forEach((user) => {
          map.set(String(user.id), { ...user, suggested_partner_user_id: partnerUserId(user) });
        });
      }

      if (meResult.status === "fulfilled" && meResult.value?.user?.id && meResult.value.user.status === "active") {
        const user = meResult.value.user;
        if (!map.has(String(user.id))) {
          map.set(String(user.id), { ...user, suggested_partner_user_id: partnerUserId(user) });
        }
      }

      users = [...map.values()];
      applyUsers();
    } catch (_error) {
      users = [];
      applyUsers();
    } finally {
      loading = false;
    }
  }

  function optionLabel(user) {
    const name = user?.name || user?.username || "임직원";
    const department = user?.department ? ` · ${user.department}` : "";
    const username = user?.username ? ` · ${user.username}` : "";
    return `${name}${department}${username}`;
  }

  function applySelect(select) {
    if (!select) return;
    const current = select.value;
    const signature = users.map((user) => String(user.id)).join("|");
    const expectedCount = users.length + 1;
    if (select.dataset.portalUserSignature === signature && select.options.length === expectedCount) return;

    select.replaceChildren();
    const placeholder = users.length ? "임직원 선택" : "선택 가능한 임직원 없음";
    select.add(new Option(placeholder, ""));
    users.forEach((user) => select.add(new Option(optionLabel(user), String(user.id))));
    select.disabled = users.length === 0;
    if ([...select.options].some((option) => option.value === current)) select.value = current;
    select.dataset.portalUserSignature = signature;
  }

  function ensureEmptyNotice(panel) {
    let notice = panel.querySelector("#perUserSourceNotice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "perUserSourceNotice";
      notice.style.cssText = "margin:0 0 12px;padding:9px 11px;border:1px solid #e7d59e;border-radius:9px;background:#fff9e9;color:#7a6226;font-size:8px;line-height:1.55";
      const grid = panel.querySelector(".per-grid");
      grid?.insertAdjacentElement("beforebegin", notice);
    }
    if (users.length) {
      notice.hidden = true;
    } else {
      notice.hidden = false;
      notice.textContent = "선택 가능한 활성 임직원이 없습니다. 포털 관리 → 임직원 관리에서 계정을 등록하거나 승인 상태를 확인해 주세요.";
    }
  }

  function applyUsers() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    applySelect(panel.querySelector("#perAndroidUser"));
    applySelect(panel.querySelector("#perPlaudUser"));
    ensureEmptyNotice(panel);
  }

  function scheduleApply() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      applyUsers();
      if (!users.length) loadUsers();
    }, 60);
  }

  document.addEventListener("change", (event) => {
    if (event.target?.id !== "perPlaudUser") return;
    const user = users.find((item) => String(item.id) === String(event.target.value));
    const panel = document.getElementById(PANEL_ID);
    const partner = panel?.querySelector("#perPartnerUser");
    if (partner && user) partner.value = user.suggested_partner_user_id || partnerUserId(user);
  }, true);

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      const target = mutation.target;
      return target?.id === PANEL_ID || target?.id === "perAndroidUser" || target?.id === "perPlaudUser" || target?.closest?.(`#${PANEL_ID}`);
    });
    if (relevant) scheduleApply();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("DOMContentLoaded", () => loadUsers());
  window.addEventListener("load", () => loadUsers());
  window.addEventListener("focus", () => loadUsers());
  loadUsers();
})();
