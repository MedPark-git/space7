const menuGroups = [
  { label: "WORKSPACE", items: [
    { id: "dashboard", icon: "▦", title: "통합 대시보드" }
  ]},
  { label: "BUSINESS", items: [
    { id: "management", icon: "▰", title: "경영사업본부", children: [
      { id: "management_ar", title: "미수채권 관리시스템", url: "https://medprk-ar-dashboard.mycafe24.ai/" },
      { id: "management_hr", title: "HR", url: "https://medprk-medpark-hr-maps.mycafe24.ai/" },
      { id: "management_routine", title: "경영 루틴 업무 시스템", url: null }
    ]},
    { id: "marketing", icon: "◫", title: "마케팅사업본부", children: [
      { id: "marketing_allo", title: "국내영업 · MedPark-Allo", url: "https://medprk-medpark-allo.mycafe24.ai/" },
      { id: "marketing_dental", title: "국내영업 · 덴탈", url: null },
      { id: "marketing_medical", title: "국내영업 · 메디컬", url: null },
      { id: "marketing_aesthetic", title: "국내영업 · 에스테틱", url: null },
      { id: "marketing_global", title: "해외영업 · Global-MAPS", url: "https://medprk-medpark-global-maps.mycafe24.ai/" }
    ]},
    { id: "technology", icon: "◇", title: "기술사업본부", children: [
      { id: "technology_focus", title: "기술부 중점 업무", url: "https://medprk-medpark-tech-conference-maps.mycafe24.ai/" }
    ]}
  ]},
  { label: "COLLABORATION", items: [
    { id: "amarans", icon: "A", title: "아마란스" },
    { id: "meetings", icon: "☷", title: "회의록" },
    { id: "calendar", icon: "□", title: "일정(캘린더)" }
  ]},
  { label: "ADMIN", items: [
    { id: "admin", icon: "⚙", title: "포털 관리" }
  ]}
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const guestView = $("#guestView");
const appView = $("#appView");
const loginModal = $("#loginModal");
const loginForm = $("#loginForm");
const pageContent = $("#pageContent");
const searchDialog = $("#searchDialog");
const employeeDialog = $("#employeeDialog");
let currentPage = "dashboard";
let carouselMode = "calendar";
let carouselTimer;
let currentUser = null;
let employeeCache = [];
let editingEmployeeId = null;

const builtInEditableMenuIds = new Set([
  "management", "management_ar", "management_hr", "management_routine",
  "marketing", "marketing_allo", "marketing_dental", "marketing_medical", "marketing_aesthetic", "marketing_global",
  "technology", "technology_focus", "amarans", "meetings", "calendar"
]);
const editableTopMenuItems = () => menuGroups.flatMap((group) => group.items).filter((item) => item.id !== "dashboard" && item.id !== "admin");
const editableMenuItems = () => editableTopMenuItems().flatMap((item) => [item, ...(item.children || [])]);

const applyMenuConfig = ({ labels = {}, customItems = [] } = {}) => {
  menuGroups.forEach((group) => {
    group.items = group.items.filter((item) => !item.isCustom);
    group.items.forEach((item) => { if (item.children) item.children = item.children.filter((child) => !child.isCustom); });
  });
  editableMenuItems().forEach((item) => {
    if (typeof labels[item.id] === "string" && labels[item.id].trim()) item.title = labels[item.id].trim();
  });
  const businessGroup = menuGroups.find((group) => group.label === "BUSINESS");
  customItems.filter((item) => !item.parent_id).forEach((item) => businessGroup.items.push({ ...item, title: item.label, children: [], isCustom: true }));
  customItems.filter((item) => item.parent_id).forEach((item) => {
    const parent = editableTopMenuItems().find((candidate) => candidate.id === item.parent_id);
    if (!parent) return;
    if (!parent.children) parent.children = [];
    parent.children.push({ ...item, title: item.label, isCustom: true });
  });
};

const loadMenuConfig = async () => {
  try {
    const response = await fetch("/api/menu", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    applyMenuConfig(await response.json());
  } catch {}
};

const showToast = (message) => {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
};

const openLogin = () => {
  loginModal.classList.add("open");
  loginModal.setAttribute("aria-hidden", "false");
  setTimeout(() => ($("#username") || $("#email"))?.focus(), 180);
};

const closeLogin = () => {
  loginModal.classList.remove("open");
  loginModal.setAttribute("aria-hidden", "true");
  $("#loginError").textContent = "";
};

[$("#openLogin"), $("#heroLogin"), $("#maskLogin")].forEach((button) => button.addEventListener("click", openLogin));
$$('[data-close-modal]').forEach((node) => node.addEventListener("click", closeLogin));
$("#togglePassword").addEventListener("click", () => {
  const input = $("#password");
  input.type = input.type === "password" ? "text" : "password";
  $("#togglePassword").textContent = input.type === "password" ? "보기" : "숨김";
});
$("#resetLink").addEventListener("click", (event) => {
  event.preventDefault();
  showToast("운영 버전에서 관리자에게 재설정을 요청할 수 있습니다.");
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginForm.classList.add("is-loading");
  $("#loginError").textContent = "";
  try {
    const usernameInput = $("#username") || $("#email");
    const passwordInput = $("#password");
    if (!usernameInput || !passwordInput) throw new Error("로그인 화면이 갱신되었습니다. 페이지를 새로고침해 주세요.");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: usernameInput.value.trim(), password: passwordInput.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    currentUser = result.user;
    sessionStorage.setItem("medpark-preview-session", JSON.stringify(result.user));
    await new Promise((resolve) => setTimeout(resolve, 350));
    closeLogin();
    await showApp();
    showToast(`${result.user.name}님, 환영합니다.`);
  } catch (error) {
    $("#loginError").textContent = error.message || "로그인 중 오류가 발생했습니다.";
  } finally {
    loginForm.classList.remove("is-loading");
  }
});

$("#logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  sessionStorage.removeItem("medpark-preview-session");
  currentUser = null;
  clearInterval(carouselTimer);
  appView.hidden = true;
  guestView.hidden = false;
  loginForm.reset();
  $("#username").value = "admin";
  $("#password").value = "Preview123!";
  showToast("안전하게 로그아웃되었습니다.");
});

const renderNavigation = () => {
  $("#mainNav").innerHTML = menuGroups.filter((group) => group.label !== "ADMIN" || currentUser?.role === "admin").map((group) => `
    <section class="nav-section">
      <div class="nav-heading">${group.label}</div>
      ${group.items.map((item) => {
        const hasChildren = Boolean(item.children?.length);
        return `
        <button class="nav-item ${item.id === currentPage ? "active" : ""}" data-nav="${escapeHtml(item.id)}" data-has-children="${hasChildren}">
          <span class="nav-icon">${escapeHtml(item.icon || "◇")}</span><span>${escapeHtml(item.title)}</span>${hasChildren ? '<span class="chevron">›</span>' : ""}
        </button>
        ${hasChildren ? `<div class="submenu" data-submenu="${escapeHtml(item.id)}"><div>${item.children.map((child) => child.url
          ? `<a data-external="${escapeHtml(child.title)}" data-url="${escapeHtml(child.url)}" href="${escapeHtml(child.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(child.title)}<span style="float:right">↗</span></a>`
          : `<button data-external="${escapeHtml(child.title)}">${escapeHtml(child.title)}<span style="float:right">·</span></button>`).join("")}</div></div>` : ""}
      `}).join("")}
    </section>
  `).join("");

  $$('[data-nav]').forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.nav;
    if (button.dataset.hasChildren === "true") {
      button.classList.toggle("expanded");
      $(`[data-submenu="${id}"]`).classList.toggle("open");
      return;
    }
    navigate(id);
  }));
  $$('button[data-external]').forEach((button) => button.addEventListener("click", () => showToast(`${button.dataset.external} 링크는 추후 연결할 예정입니다.`)));
};

const navigate = (page) => {
  currentPage = page;
  clearInterval(carouselTimer);
  renderNavigation();
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.nav === page));
  const title = menuGroups.flatMap((g) => g.items).find((item) => item.id === page)?.title || "통합 대시보드";
  $("#breadcrumbText").textContent = title;
  if (page === "dashboard") renderDashboard();
  else if (page === "admin") renderAdmin();
  else renderPlaceholder(title, page);
  closeSidebar();
};

const renderCalendarDays = () => {
  const heads = ["일", "월", "화", "수", "목", "금", "토"].map((d) => `<div class="day-head">${d}</div>`).join("");
  const days = Array.from({ length: 35 }, (_, index) => {
    const value = index < 5 ? 27 + index : index - 4;
    const muted = index < 5 || index > 34;
    const today = value === 26 && !muted;
    const event = value === 26 ? '<span class="event-dot">본부장 주간회의</span>' : value === 28 ? '<span class="event-dot">신규 입사자 안내</span>' : "";
    return `<div class="${muted ? "muted-day" : ""} ${today ? "today-day" : ""}">${value}${event}</div>`;
  }).join("");
  return heads + days;
};

const koreaMap = `
  <svg class="map-shape" viewBox="0 0 300 360" aria-label="국내 진행 현황 지도">
    <path fill="currentColor" d="M172 20l28 16 12 31-11 26 25 31-4 42 17 28-17 38-8 38-30 21-12 38-37 31-18-22-1-41-25-25 4-38-15-31 15-39-12-33 28-18 8-38 27-19 10-41z"/>
    <path fill="#d3e6df" d="M207 315l13 8-7 14-16 5-8-11z"/>
  </svg>`;

const renderCarousel = () => {
  const body = $("#carouselBody");
  if (!body) return;
  $$('[data-carousel]').forEach((button) => button.classList.toggle("active", button.dataset.carousel === carouselMode));
  body.innerHTML = carouselMode === "calendar" ? `
    <div class="calendar-view">
      <div class="calendar-area"><div class="calendar-top"><button>‹</button><b>2026년 8월</b><button>›</button></div><div class="calendar-grid">${renderCalendarDays()}</div></div>
      <aside class="schedule-list"><h3>8월 26일 수요일</h3>
        <div class="schedule-item"><time>09:30 - 10:30</time><b>본부장 주간회의</b><span>8층 대회의실</span></div>
        <div class="schedule-item"><time>13:30 - 14:00</time><b>IT 인프라 점검</b><span>온라인 미팅</span></div>
        <div class="schedule-item"><time>16:00 - 17:00</time><b>포털 구축 리뷰</b><span>프로젝트룸</span></div>
      </aside>
    </div>` : `
    <div class="map-view">
      <div class="map-stage">${koreaMap}<button class="map-pin pin-one" data-label="수도권 12건"></button><button class="map-pin pin-two" data-label="충청권 7건"></button><button class="map-pin pin-three" data-label="영남권 9건"></button></div>
      <aside class="map-list"><h3>국내 진행 현황</h3>
        <div class="map-item"><i></i><div><b>수도권</b><span>최근 업데이트 10분 전</span></div><strong>12건</strong></div>
        <div class="map-item"><i></i><div><b>충청권</b><span>최근 업데이트 24분 전</span></div><strong>7건</strong></div>
        <div class="map-item"><i></i><div><b>영남권</b><span>최근 업데이트 32분 전</span></div><strong>9건</strong></div>
        <div class="map-item"><i style="background:#74b7a5"></i><div><b>호남·제주권</b><span>최근 업데이트 1시간 전</span></div><strong>5건</strong></div>
      </aside>
    </div>`;
  $("#carouselProgress").innerHTML = "<i></i>";
  $$('[data-carousel]').forEach((button) => button.onclick = () => {
    carouselMode = button.dataset.carousel;
    renderCarousel();
    startCarousel();
  });
  $$(".map-pin").forEach((pin) => pin.addEventListener("click", () => showToast(`${pin.dataset.label} 상세 패널은 지도 API 연동 후 표시됩니다.`)));
};

const startCarousel = () => {
  clearInterval(carouselTimer);
  carouselTimer = setInterval(() => {
    carouselMode = carouselMode === "calendar" ? "map" : "calendar";
    renderCarousel();
  }, 30000);
};

const renderDashboard = () => {
  pageContent.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">OVERVIEW</span><h1>안녕하세요, ${currentUser?.name || "임직원"}님</h1><p>오늘의 주요 일정과 사업 현황을 한눈에 확인하세요.</p></div><span class="live-status"><i></i> 시스템 정상 운영 중</span></section>
    <section class="dashboard-summary">
      <div class="metric-stack">
        <article class="metric-card"><div class="metric-label"><span>오늘의 일정</span><i class="metric-icon">□</i></div><strong>3</strong><small>건 예정</small></article>
        <article class="metric-card"><div class="metric-label"><span>새 회의록</span><i class="metric-icon">☷</i></div><strong>5</strong><small>건 등록</small></article>
      </div>
      <article class="panel quick-panel"><header class="panel-header"><div><h2>자주 찾는 시스템</h2><p>외부 시스템 바로가기</p></div><span>↗</span></header><div class="quick-grid">
        <a class="quick-link" href="https://medprk-ar-dashboard.mycafe24.ai/" target="_blank" rel="noopener noreferrer"><i>₩</i><b>미수채권</b></a>
        <a class="quick-link" href="https://medprk-medpark-hr-maps.mycafe24.ai/" target="_blank" rel="noopener noreferrer"><i>♙</i><b>HR</b></a>
        <a class="quick-link" href="https://medprk-medpark-allo.mycafe24.ai/" target="_blank" rel="noopener noreferrer"><i>◫</i><b>MedPark-Allo</b></a>
        <a class="quick-link" href="https://medprk-medpark-global-maps.mycafe24.ai/" target="_blank" rel="noopener noreferrer"><i>◎</i><b>Global-MAPS</b></a>
      </div></article>
    </section>
    <article class="panel workspace-panel">
      <header class="panel-header"><div><h2>워크스페이스 현황</h2><p>캘린더와 진행 지도를 30초마다 자동 전환합니다.</p></div><div class="segmented"><button data-carousel="calendar" class="active">캘린더</button><button data-carousel="map">진행 지도</button></div></header>
      <div id="carouselBody" class="carousel-body"></div><div id="carouselProgress" class="carousel-progress"><i></i></div>
    </article>`;
  renderCarousel();
  startCarousel();
};

const renderAdmin = () => {
  pageContent.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">ADMINISTRATION</span><h1>포털 관리</h1><p>임직원, 메뉴와 접근 권한을 코드 수정 없이 관리합니다.</p></div><button id="addEmployee" class="button primary">＋ 임직원 등록</button></section>
    <section class="content-panel"><div class="admin-tabs"><button class="active" data-admin-tab="employees">임직원 관리</button><button data-admin-tab="menus">메뉴 관리</button><button data-admin-tab="permissions">권한 관리</button><button data-admin-tab="audits">감사 로그</button></div><div id="adminBody"></div></section>`;
  renderAdminTab("employees");
  $$('.admin-tabs [data-admin-tab]').forEach((button) => button.addEventListener("click", () => {
    $$('.admin-tabs [data-admin-tab]').forEach((tab) => tab.classList.toggle("active", tab === button));
    renderAdminTab(button.dataset.adminTab);
  }));
};

const renderAdminTab = (tab) => {
  const body = $("#adminBody");
  const addButton = $("#addEmployee");
  if (tab === "employees") {
    addButton.hidden = false;
    body.innerHTML = `
      <div class="toolbar"><input id="employeeSearch" placeholder="계정 ID, 이름, 사번, 부서 검색" /><span class="live-status"><i></i> 활성 임직원 <b id="activeCount">-</b>명</span></div>
      <table class="data-table"><thead><tr><th>계정 ID</th><th>성명</th><th>사번</th><th>소속</th><th>권한</th><th>상태</th><th>관리</th></tr></thead><tbody id="employeeRows"><tr><td colspan="7">계정 정보를 불러오는 중입니다.</td></tr></tbody></table>`;
    loadEmployees();
    $("#employeeSearch").addEventListener("input", (event) => {
      const q = event.target.value.toLowerCase();
      renderEmployees(employeeCache.filter((user) => Object.values(user).join(" ").toLowerCase().includes(q)));
    });
    addButton.onclick = openCreateEmployee;
    return;
  }
  addButton.hidden = true;
  if (tab === "menus") {
    body.innerHTML = `
      <div class="menu-admin-layout">
        <form id="menuLabelsForm" class="menu-labels-form">
          <div class="menu-manager-heading"><div><h2>카테고리 이름 관리</h2><p>최상단과 하위 카테고리 이름을 함께 수정합니다. 기존 연결 주소와 권한은 유지됩니다.</p></div><button class="button primary" type="submit">변경사항 저장</button></div>
          <div class="menu-label-groups">${editableTopMenuItems().map((parent) => `
            <section class="menu-edit-group">
              <label class="top-menu-label"><span>최상단 카테고리</span><input name="${escapeHtml(parent.id)}" value="${escapeHtml(parent.title)}" minlength="1" maxlength="40" required /></label>
              <div class="child-menu-list">${(parent.children || []).length ? parent.children.map((child) => `
                <label><span>하위 카테고리${child.url ? ` · 연결됨` : ""}</span><input name="${escapeHtml(child.id)}" value="${escapeHtml(child.title)}" minlength="1" maxlength="40" required /></label>`).join("") : '<p class="empty-child-menu">등록된 하위 카테고리가 없습니다.</p>'}</div>
            </section>`).join("")}</div>
          <p id="menuLabelsError" class="form-error"></p>
        </form>
        <form id="menuCreateForm" class="menu-create-form">
          <div><span class="eyebrow">NEW CATEGORY</span><h2>카테고리 등록</h2><p>최상단 또는 선택한 카테고리 아래에 새 메뉴를 추가합니다.</p></div>
          <label>등록 위치<select name="parent_id"><option value="">최상단 카테고리</option>${editableTopMenuItems().map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)} 하위</option>`).join("")}</select></label>
          <label>카테고리 이름<input name="label" minlength="1" maxlength="40" placeholder="새 카테고리 이름" required /></label>
          <label>연결 URL <small>선택 · 하위 카테고리용</small><input name="url" type="url" placeholder="https://" /></label>
          <label>아이콘 <small>선택 · 최상단 카테고리용</small><input name="icon" maxlength="2" placeholder="◇" /></label>
          <p id="menuCreateError" class="form-error"></p>
          <button class="button primary full" type="submit">＋ 카테고리 등록</button>
        </form>
      </div>`;
    $("#menuLabelsForm").addEventListener("submit", saveMenuLabels);
    $("#menuCreateForm").addEventListener("submit", createMenuItem);
    return;
  }
  body.innerHTML = `<div class="placeholder-state compact"><div><i>${tab === "permissions" ? "◇" : "☷"}</i><h2>${tab === "permissions" ? "권한 관리" : "감사 로그"}</h2><p>이 기능은 다음 구현 단계에서 연결됩니다.</p></div></div>`;
};

const saveMenuLabels = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const labels = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  $("#menuLabelsError").textContent = "";
  try {
    const response = await fetch("/api/admin/menu", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ labels }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    applyMenuConfig(result);
    renderNavigation();
    $("#breadcrumbText").textContent = "포털 관리";
    showToast("카테고리 이름이 저장되었습니다.");
  } catch (error) {
    $("#menuLabelsError").textContent = error.message || "카테고리 이름 저장에 실패했습니다.";
  } finally {
    submit.disabled = false;
  }
};

const createMenuItem = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  $("#menuCreateError").textContent = "";
  try {
    const response = await fetch("/api/admin/menu", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    applyMenuConfig(result);
    renderNavigation();
    $("#breadcrumbText").textContent = "포털 관리";
    renderAdminTab("menus");
    showToast(`${result.item.label} 카테고리가 등록되었습니다.`);
  } catch (error) {
    $("#menuCreateError").textContent = error.message || "카테고리 등록에 실패했습니다.";
  } finally {
    submit.disabled = false;
  }
};

const loadEmployees = async () => {
  try {
    const response = await fetch("/api/admin/users", { headers: { accept: "application/json" } });
    if (response.status === 401 || response.status === 403) throw new Error("관리자 권한을 확인해 주세요.");
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    employeeCache = result.users;
    if (!$("#employeeRows")) return;
    renderEmployees(employeeCache);
    if ($("#activeCount")) $("#activeCount").textContent = employeeCache.filter((user) => user.status === "active").length;
  } catch (error) {
    if ($("#employeeRows")) $("#employeeRows").innerHTML = `<tr><td colspan="7">${escapeHtml(error.message || "계정 정보를 불러오지 못했습니다.")}</td></tr>`;
  }
};

const renderEmployees = (rows) => {
  if (!$("#employeeRows")) return;
  $("#employeeRows").innerHTML = rows.map((user) => `<tr>
    <td><b>${escapeHtml(user.username)}</b></td><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.employee_no || "-")}</td><td>${escapeHtml(user.department || "-")}</td>
    <td><span class="tag">${user.role === "admin" ? "관리자" : "기본"}</span></td><td><span class="tag ${user.status !== "active" ? "gray" : ""}">${user.status === "active" ? "활성" : "비활성"}</span></td>
    <td><div class="account-actions"><button data-edit-user="${user.id}">정보 수정</button><button data-toggle-user="${user.id}" data-next-status="${user.status === "active" ? "terminated" : "active"}">${user.status === "active" ? "비활성화" : "재활성화"}</button><button data-reset-user="${user.id}">비밀번호 초기화</button></div></td>
  </tr>`).join("") || '<tr><td colspan="7">등록된 계정이 없습니다.</td></tr>';
  $$('[data-edit-user]').forEach((button) => button.addEventListener("click", () => openEditEmployee(button.dataset.editUser)));
  $$('[data-toggle-user]').forEach((button) => button.addEventListener("click", async () => {
    if (button.dataset.toggleUser === currentUser?.id && button.dataset.nextStatus === "terminated") return showToast("현재 로그인한 관리자 계정은 비활성화할 수 없습니다.");
    await updateEmployee(button.dataset.toggleUser, { status: button.dataset.nextStatus });
  }));
  $$('[data-reset-user]').forEach((button) => button.addEventListener("click", async () => {
    const password = prompt("새 초기 비밀번호를 입력하세요. (8자 이상)");
    if (password) await updateEmployee(button.dataset.resetUser, { password });
  }));
};

const configureEmployeeDialog = (mode, user = null) => {
  const form = $("#employeeForm");
  const usernameInput = form.elements.username;
  const passwordInput = form.elements.password;
  editingEmployeeId = mode === "edit" ? user.id : null;
  form.reset();
  $("#employeeFormError").textContent = "";
  $("#employeeDialogTitle").textContent = mode === "edit" ? "임직원 정보 수정" : "임직원 계정 등록";
  $("#employeeDialogDescription").textContent = mode === "edit" ? "계정 ID를 제외한 임직원 정보를 수정합니다." : "로그인에 사용할 계정 ID와 초기 정보를 입력합니다.";
  $("#employeeSubmitButton").textContent = mode === "edit" ? "변경사항 저장" : "계정 등록";
  $("#employeePasswordField").hidden = mode === "edit";
  usernameInput.disabled = mode === "edit";
  passwordInput.disabled = mode === "edit";
  passwordInput.required = mode !== "edit";
  if (mode === "edit") {
    usernameInput.value = user.username;
    form.elements.name.value = user.name || "";
    form.elements.employee_no.value = user.employee_no || "";
    form.elements.department.value = user.department || "";
    form.elements.email.value = user.email || "";
    form.elements.role.value = user.role;
  }
};

const openCreateEmployee = () => {
  configureEmployeeDialog("create");
  employeeDialog.showModal();
};

const openEditEmployee = (id) => {
  const user = employeeCache.find((item) => item.id === id);
  if (!user) return showToast("수정할 계정을 찾을 수 없습니다.");
  configureEmployeeDialog("edit", user);
  employeeDialog.showModal();
};

const updateEmployee = async (id, payload) => {
  try {
    const response = await fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    showToast("계정 정보가 변경되었습니다.");
    await loadEmployees();
  } catch (error) { showToast(error.message || "계정 변경에 실패했습니다."); }
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char]));

$$('[data-close-employee]').forEach((button) => button.addEventListener("click", () => employeeDialog.close()));
$("#employeeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  $("#employeeFormError").textContent = "";
  try {
    const editing = Boolean(editingEmployeeId);
    const response = await fetch(editing ? `/api/admin/users/${editingEmployeeId}` : "/api/admin/users", { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    if (result.user.id === currentUser?.id) {
      currentUser = result.user;
      sessionStorage.setItem("medpark-preview-session", JSON.stringify(result.user));
      $(".profile b").textContent = result.user.name;
      $(".profile small").textContent = `${result.user.department || "소속 미지정"} · 관리자`;
      $(".profile .avatar").textContent = result.user.name.slice(0, 1);
    }
    form.reset(); employeeDialog.close(); showToast(editing ? `${result.user.username} 계정 정보가 수정되었습니다.` : `${result.user.username} 계정이 등록되었습니다.`);
    await loadEmployees();
  } catch (error) { $("#employeeFormError").textContent = error.message || (editingEmployeeId ? "계정 수정에 실패했습니다." : "계정 등록에 실패했습니다."); }
});

const renderPlaceholder = (title, icon) => {
  pageContent.innerHTML = `<section class="page-heading"><div><span class="eyebrow">CONNECTED SYSTEM</span><h1>${title}</h1><p>외부 시스템 또는 API 연결을 준비하고 있습니다.</p></div></section><section class="content-panel"><div class="placeholder-state"><div><i>${icon === "calendar" ? "□" : icon === "meetings" ? "☷" : "↗"}</i><h2>${title} 연결 준비 중</h2><p>관리자가 실제 URL 또는 API 인증정보를 등록하면 이곳에서 바로 사용할 수 있습니다.</p><button class="button primary" style="margin-top:20px" id="configButton">연결 설정 보기</button></div></div></section>`;
  $("#configButton").addEventListener("click", () => showToast("보안을 위해 인증정보는 배포 환경변수로 등록합니다."));
};

const openSidebar = () => { $("#sidebar").classList.add("open"); $("#sidebarBackdrop").classList.add("open"); };
const closeSidebar = () => { $("#sidebar").classList.remove("open"); $("#sidebarBackdrop").classList.remove("open"); };
$("#openSidebar").addEventListener("click", openSidebar);
$("#closeSidebar").addEventListener("click", closeSidebar);
$("#sidebarBackdrop").addEventListener("click", closeSidebar);

const setupSearch = () => {
  const draw = (query = "") => {
    const allItems = menuGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
    const items = allItems.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));
    $("#searchResults").innerHTML = items.map((item) => `<button type="button" class="search-result" data-search-page="${item.id}"><b>${item.icon} &nbsp; ${item.title}</b><span>${item.group}</span></button>`).join("") || '<div style="padding:30px;text-align:center;color:#8a9693;font-size:11px">검색 결과가 없습니다.</div>';
    $$('[data-search-page]').forEach((button) => button.addEventListener("click", () => { searchDialog.close(); navigate(button.dataset.searchPage); }));
  };
  $("#searchButton").addEventListener("click", () => { draw(); searchDialog.showModal(); setTimeout(() => $("#menuSearch").focus(), 50); });
  $("#menuSearch").addEventListener("input", (event) => draw(event.target.value));
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); draw(); searchDialog.showModal(); }
  });
};

$("#noticeButton").addEventListener("click", () => showToast("읽지 않은 알림이 3개 있습니다."));

const showApp = async () => {
  guestView.hidden = true;
  appView.hidden = false;
  await loadMenuConfig();
  const now = new Date();
  $("#todayLabel").textContent = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(now);
  $(".profile b").textContent = currentUser?.name || "임직원";
  $(".profile small").textContent = `${currentUser?.department || "소속 미지정"} · ${currentUser?.role === "admin" ? "관리자" : "임직원"}`;
  $(".profile .avatar").textContent = (currentUser?.name || "M").slice(0, 1);
  renderNavigation();
  navigate("dashboard");
};

setupSearch();
if (location.protocol === "file:" && new URLSearchParams(location.search).get("mode") === "app") {
  currentUser = { name: "김관리", role: "admin", department: "경영지원본부" };
  sessionStorage.setItem("medpark-preview-session", JSON.stringify(currentUser));
  showApp();
} else {
  fetch("/api/auth/me", { headers: { accept: "application/json" } }).then(async (response) => {
    if (!response.ok) throw new Error("no-session");
    const result = await response.json();
    currentUser = result.user;
    sessionStorage.setItem("medpark-preview-session", JSON.stringify(result.user));
    await showApp();
  }).catch(() => {
    sessionStorage.removeItem("medpark-preview-session");
    guestView.hidden = false;
    appView.hidden = true;
  });
}
