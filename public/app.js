const menuGroups = [
  { label: "WORKSPACE", items: [
    { id: "dashboard", icon: "▦", title: "통합 대시보드" }
  ]},
  { label: "BUSINESS", items: [
    { id: "management", icon: "▰", title: "경영사업본부", children: ["미수채권 관리시스템", "HR", "경영 루틴 업무"] },
    { id: "marketing", icon: "◫", title: "마케팅사업본부", children: ["국내영업 · MedPark-Allo", "국내영업 · 덴탈", "국내영업 · 메디컬", "국내영업 · 에스테틱", "해외영업 · Global-MAPS"] },
    { id: "technology", icon: "◇", title: "기술사업본부", children: ["기술부 중점 업무"] }
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
    showApp();
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
      ${group.items.map((item) => `
        <button class="nav-item ${item.id === currentPage ? "active" : ""}" data-nav="${item.id}" data-has-children="${Boolean(item.children)}">
          <span class="nav-icon">${item.icon}</span><span>${item.title}</span>${item.children ? '<span class="chevron">›</span>' : ""}
        </button>
        ${item.children ? `<div class="submenu" data-submenu="${item.id}"><div>${item.children.map((child) => `<button data-external="${child}">${child}<span style="float:right">↗</span></button>`).join("")}</div></div>` : ""}
      `).join("")}
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
  $$('[data-external]').forEach((button) => button.addEventListener("click", () => showToast(`${button.dataset.external} 링크는 관리자 화면에서 등록합니다.`)));
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
    <section class="metric-grid">
      <article class="metric-card"><div class="metric-label"><span>오늘의 일정</span><i class="metric-icon">□</i></div><strong>3</strong><small>건 예정</small></article>
      <article class="metric-card"><div class="metric-label"><span>진행 프로젝트</span><i class="metric-icon">◎</i></div><strong>33</strong><small>건 진행</small></article>
      <article class="metric-card"><div class="metric-label"><span>새 회의록</span><i class="metric-icon">☷</i></div><strong>5</strong><small>건 등록</small></article>
      <article class="metric-card"><div class="metric-label"><span>연결 시스템</span><i class="metric-icon">◇</i></div><strong>8</strong><small>개 정상</small></article>
    </section>
    <section class="dashboard-grid">
      <article class="panel">
        <header class="panel-header"><div><h2>워크스페이스 현황</h2><p>캘린더와 진행 지도를 30초마다 자동 전환합니다.</p></div><div class="segmented"><button data-carousel="calendar" class="active">캘린더</button><button data-carousel="map">진행 지도</button></div></header>
        <div id="carouselBody" class="carousel-body"></div><div id="carouselProgress" class="carousel-progress"><i></i></div>
      </article>
      <aside class="side-stack">
        <article class="panel"><header class="panel-header"><div><h2>자주 찾는 시스템</h2><p>외부 시스템 바로가기</p></div><span>↗</span></header><div class="quick-grid">
          <button class="quick-link" data-quick="미수채권"><i>₩</i><b>미수채권</b></button><button class="quick-link" data-quick="HR"><i>♙</i><b>HR</b></button><button class="quick-link" data-quick="아마란스"><i>A</i><b>아마란스</b></button><button class="quick-link" data-quick="Global-MAPS"><i>◎</i><b>Global-MAPS</b></button>
        </div></article>
        <article class="panel"><header class="panel-header"><div><h2>공지 및 업데이트</h2><p>포털 운영 소식</p></div><span>＋</span></header><div class="notice-list">
          <div class="notice-item"><b>사내 통합 포털 1차 미리보기 안내</b><span>오늘 · IT 운영팀</span></div><div class="notice-item"><b>개인정보 보호 및 보안 정책 안내</b><span>8월 25일 · 경영지원본부</span></div><div class="notice-item"><b>Google Calendar 연동 준비 중</b><span>8월 24일 · 시스템</span></div>
        </div></article>
      </aside>
    </section>`;
  renderCarousel();
  startCarousel();
  $$('[data-quick]').forEach((button) => button.addEventListener("click", () => showToast(`${button.dataset.quick} URL은 포털 관리에서 등록합니다.`)));
};

const renderAdmin = () => {
  pageContent.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">ADMINISTRATION</span><h1>포털 관리</h1><p>임직원, 메뉴와 접근 권한을 코드 수정 없이 관리합니다.</p></div><button id="addEmployee" class="button primary">＋ 임직원 등록</button></section>
    <section class="content-panel"><div class="admin-tabs"><button class="active">임직원 관리</button><button>메뉴 관리</button><button>권한 관리</button><button>감사 로그</button></div>
      <div class="toolbar"><input id="employeeSearch" placeholder="계정 ID, 이름, 사번, 부서 검색" /><span class="live-status"><i></i> 활성 임직원 <b id="activeCount">-</b>명</span></div>
      <table class="data-table"><thead><tr><th>계정 ID</th><th>성명</th><th>사번</th><th>소속</th><th>권한</th><th>상태</th><th>관리</th></tr></thead><tbody id="employeeRows"><tr><td colspan="7">계정 정보를 불러오는 중입니다.</td></tr></tbody></table>
    </section>`;
  loadEmployees();
  $("#employeeSearch").addEventListener("input", (event) => {
    const q = event.target.value.toLowerCase();
    renderEmployees(employeeCache.filter((user) => Object.values(user).join(" ").toLowerCase().includes(q)));
  });
  $("#addEmployee").addEventListener("click", () => { $("#employeeFormError").textContent = ""; employeeDialog.showModal(); });
  $$(".admin-tabs button").forEach((button) => button.addEventListener("click", () => {
    $$(".admin-tabs button").forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    if (button.textContent !== "임직원 관리") showToast(`${button.textContent} 화면은 다음 구현 단계에서 연결됩니다.`);
  }));
};

const loadEmployees = async () => {
  try {
    const response = await fetch("/api/admin/users", { headers: { accept: "application/json" } });
    if (response.status === 401 || response.status === 403) throw new Error("관리자 권한을 확인해 주세요.");
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    employeeCache = result.users;
    renderEmployees(employeeCache);
    $("#activeCount").textContent = employeeCache.filter((user) => user.status === "active").length;
  } catch (error) {
    $("#employeeRows").innerHTML = `<tr><td colspan="7">${escapeHtml(error.message || "계정 정보를 불러오지 못했습니다.")}</td></tr>`;
  }
};

const renderEmployees = (rows) => {
  $("#employeeRows").innerHTML = rows.map((user) => `<tr>
    <td><b>${escapeHtml(user.username)}</b></td><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.employee_no || "-")}</td><td>${escapeHtml(user.department || "-")}</td>
    <td><span class="tag">${user.role === "admin" ? "관리자" : "기본"}</span></td><td><span class="tag ${user.status !== "active" ? "gray" : ""}">${user.status === "active" ? "활성" : "비활성"}</span></td>
    <td><div class="account-actions"><button data-toggle-user="${user.id}" data-next-status="${user.status === "active" ? "terminated" : "active"}">${user.status === "active" ? "비활성화" : "재활성화"}</button><button data-reset-user="${user.id}">비밀번호 초기화</button></div></td>
  </tr>`).join("") || '<tr><td colspan="7">등록된 계정이 없습니다.</td></tr>';
  $$('[data-toggle-user]').forEach((button) => button.addEventListener("click", async () => {
    if (button.dataset.toggleUser === currentUser?.id && button.dataset.nextStatus === "terminated") return showToast("현재 로그인한 관리자 계정은 비활성화할 수 없습니다.");
    await updateEmployee(button.dataset.toggleUser, { status: button.dataset.nextStatus });
  }));
  $$('[data-reset-user]').forEach((button) => button.addEventListener("click", async () => {
    const password = prompt("새 초기 비밀번호를 입력하세요. (8자 이상)");
    if (password) await updateEmployee(button.dataset.resetUser, { password });
  }));
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
    const response = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    form.reset(); employeeDialog.close(); showToast(`${result.user.username} 계정이 등록되었습니다.`);
    await loadEmployees();
  } catch (error) { $("#employeeFormError").textContent = error.message || "계정 등록에 실패했습니다."; }
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
  const allItems = menuGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
  const draw = (query = "") => {
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

const showApp = () => {
  guestView.hidden = true;
  appView.hidden = false;
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
    showApp();
  }).catch(() => {
    sessionStorage.removeItem("medpark-preview-session");
    guestView.hidden = false;
    appView.hidden = true;
  });
}
