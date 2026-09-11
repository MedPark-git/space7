(() => {
  const STYLE_ID = "plaudAdminOnlyMenuStyle";
  const ROLE_ATTR = "data-plaud-admin-menu-role";
  const TARGET_SUB_PAGES = new Set(["meetings_plaud", "meetings_plaud_device"]);
  let role = "unknown";
  let checking = false;
  let lastCheckedAt = 0;
  let timer = null;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html:not([${ROLE_ATTR}="admin"]) #mainNav [data-sub-page="meetings_plaud"],
      html:not([${ROLE_ATTR}="admin"]) #mainNav [data-sub-page="meetings_plaud_device"],
      html:not([${ROLE_ATTR}="admin"]) #searchResults [data-sub-page="meetings_plaud"],
      html:not([${ROLE_ATTR}="admin"]) #searchResults [data-sub-page="meetings_plaud_device"] {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function isProtectedPlaudLabel(text) {
    const compact = String(text || "").replace(/\s+/g, "");
    return (
      compact.includes("회의록_Plaud(기기)") ||
      compact.includes("회의록Plaud(기기)") ||
      compact.includes("회의록_Plaud") ||
      compact.includes("회의록Plaud")
    );
  }

  function isTargetNode(node) {
    const subPage = node.getAttribute("data-sub-page") || "";
    if (TARGET_SUB_PAGES.has(subPage)) return true;
    return isProtectedPlaudLabel(node.textContent);
  }

  function applyVisibility() {
    const isAdmin = role === "admin";
    const candidates = document.querySelectorAll(
      '#mainNav button, #mainNav a, #searchResults button, #searchResults a, #searchResults [role="button"]'
    );

    candidates.forEach((node) => {
      if (!isTargetNode(node)) return;

      if (isAdmin) {
        if (node.dataset.plaudAdminRoleHidden === "1") {
          node.style.removeProperty("display");
          delete node.dataset.plaudAdminRoleHidden;
        }
      } else {
        node.dataset.plaudAdminRoleHidden = "1";
        node.style.setProperty("display", "none", "important");
      }
    });
  }

  function setRole(nextRole) {
    role = nextRole === "admin" ? "admin" : "basic";
    document.documentElement.setAttribute(ROLE_ATTR, role);
    applyVisibility();
  }

  async function refreshRole(force = false) {
    const now = Date.now();
    if (checking) return;
    if (!force && now - lastCheckedAt < 1500) {
      applyVisibility();
      return;
    }

    checking = true;
    lastCheckedAt = now;
    try {
      const response = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setRole("basic");
        return;
      }
      const data = await response.json();
      setRole(data?.user?.role || "basic");
    } catch (_error) {
      setRole("basic");
    } finally {
      checking = false;
    }
  }

  function scheduleRoleCheck(force = false) {
    clearTimeout(timer);
    timer = setTimeout(() => refreshRole(force), 40);
  }

  ensureStyle();
  document.documentElement.setAttribute(ROLE_ATTR, "basic");

  const observer = new MutationObserver(() => {
    applyVisibility();
    scheduleRoleCheck(false);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("DOMContentLoaded", () => scheduleRoleCheck(true));
  window.addEventListener("load", () => scheduleRoleCheck(true));
  window.addEventListener("focus", () => scheduleRoleCheck(true));

  document.addEventListener("submit", (event) => {
    if (event.target?.id !== "loginForm") return;
    setTimeout(() => scheduleRoleCheck(true), 500);
    setTimeout(() => scheduleRoleCheck(true), 1200);
  }, true);

  document.addEventListener("click", (event) => {
    if (event.target?.closest?.("#logout")) {
      setRole("basic");
      return;
    }

    const target = event.target?.closest?.('[data-sub-page="meetings_plaud"], [data-sub-page="meetings_plaud_device"]');
    if (target && role !== "admin") {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    }
  }, true);

  scheduleRoleCheck(true);
})();
