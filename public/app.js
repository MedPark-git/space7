const menuGroups = [
  { id: "workspace", label: "WORKSPACE", items: [
    { id: "dashboard", icon: "▦", title: "통합 대시보드" }
  ]},
  { id: "business", label: "BUSINESS", items: [
    { id: "management", icon: "▰", title: "경영사업본부", children: [
      { id: "management_ar", title: "미수채권 관리시스템", url: "https://medprk-ar-dashboard.mycafe24.ai/" },
      { id: "management_hr", title: "HR", url: "https://medprk-medpark-hr-maps.mycafe24.ai/" },
      { id: "management_routine", title: "경영 루틴 업무 시스템", url: null }
    ]},
    { id: "marketing", icon: "◫", title: "마케팅 사업본부", children: [
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
  { id: "collaboration", label: "COLLABORATION", items: [
    { id: "amarans", icon: "A", title: "아마란스", url: "https://gw.medpark.kr/" },
    { id: "meetings", icon: "☷", title: "회의록" },
    { id: "calendar", icon: "□", title: "일정(캘린더)" }
  ]},
  { id: "admin", label: "ADMIN", items: [
    { id: "admin", icon: "⚙", title: "포털 관리" },
    { id: "calendar_admin", icon: "□", title: "일정(캘린더)_관리자" }
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
const quickLinksDialog = $("#quickLinksDialog");
let currentPage = "dashboard";
let carouselMode = "calendar";
let carouselTimer;
let currentUser = null;
let calendarMonth = new Date();
let selectedCalendarDateKey = null;
let employeeCache = [];
let editingEmployeeId = null;
let quickLinks = [];
let quickLinkCatalog = [];

const builtInEditableMenuIds = new Set([
  "group_workspace", "group_business", "group_collaboration",
  "management", "management_ar", "management_hr", "management_routine",
  "marketing", "marketing_allo", "marketing_dental", "marketing_medical", "marketing_aesthetic", "marketing_global",
  "technology", "technology_focus", "amarans", "meetings", "calendar", "calendar_admin"
]);
const editableTopMenuItems = () => menuGroups.flatMap((group) => group.items).filter((item) => item.id !== "dashboard" && item.id !== "admin");
const editableMenuItems = () => editableTopMenuItems().flatMap((item) => [item, ...(item.children || [])]);
const configurableMenuGroups = () => menuGroups.filter((group) => group.id !== "admin");

const sortMenuItems = (items, scope, order = {}) => items
  .map((item, index) => ({ item, index }))
  .sort((a, b) => {
    const aOrder = order[a.item.id]?.parent_id === scope ? Number(order[a.item.id].item_order) : 1000 + Number(a.item.item_order ?? a.index);
    const bOrder = order[b.item.id]?.parent_id === scope ? Number(order[b.item.id].item_order) : 1000 + Number(b.item.item_order ?? b.index);
    return aOrder - bOrder || a.index - b.index;
  })
  .map(({ item }) => item);

const applyMenuConfig = ({ labels = {}, customItems = [], order = {} } = {}) => {
  menuGroups.forEach((group) => {
    group.items = group.items.filter((item) => !item.isCustom);
    group.items.forEach((item) => { if (item.children) item.children = item.children.filter((child) => !child.isCustom); });
  });
  editableMenuItems().forEach((item) => {
    if (typeof labels[item.id] === "string" && labels[item.id].trim()) item.title = labels[item.id].trim();
  });
  configurableMenuGroups().forEach((group) => {
    const label = labels[`group_${group.id}`];
    if (typeof label === "string" && label.trim()) group.label = label.trim();
  });
  customItems.filter((item) => !item.parent_id || configurableMenuGroups().some((group) => group.id === item.parent_id)).forEach((item) => {
    const groupId = item.parent_id || "business";
    const group = menuGroups.find((candidate) => candidate.id === groupId);
    if (group) group.items.push({ ...item, title: item.label, children: [], isCustom: true });
  });
  customItems.filter((item) => item.parent_id && !configurableMenuGroups().some((group) => group.id === item.parent_id)).forEach((item) => {
    const parent = editableTopMenuItems().find((candidate) => candidate.id === item.parent_id);
    if (!parent) return;
    if (!parent.children) parent.children = [];
    parent.children.push({ ...item, title: item.label, isCustom: true });
  });
  const adminGroup = menuGroups.find((group) => group.id === "admin");
  const publicGroups = sortMenuItems(configurableMenuGroups(), "root", order);
  menuGroups.splice(0, menuGroups.length, ...publicGroups, adminGroup);
  configurableMenuGroups().forEach((group) => {
    group.items = sortMenuItems(group.items, group.id, order);
    group.items.forEach((item) => { if (item.children) item.children = sortMenuItems(item.children, item.id, order); });
  });
};

const loadMenuConfig = async () => {
  try {
    const response = await fetch("/api/menu", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    applyMenuConfig(await response.json());
  } catch {}
};

const loadQuickLinks = async () => {
  try {
    const response = await fetch("/api/quick-links", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const result = await response.json();
    quickLinks = result.links || [];
    quickLinkCatalog = result.catalog || [];
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

const enforceEnglishLoginInput = (input, allowedPattern) => {
  const clean = () => {
    const next = [...input.value].filter((character) => allowedPattern.test(character)).join("");
    if (next === input.value) return;
    input.value = next;
    $("#loginError").textContent = "계정 ID와 비밀번호는 영문 자판으로 입력해 주세요.";
  };
  input.addEventListener("input", clean);
  input.addEventListener("compositionend", clean);
};
enforceEnglishLoginInput($("#username"), /^[A-Za-z0-9._-]$/);
enforceEnglishLoginInput($("#password"), /^[\x20-\x7E]$/);

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginForm.classList.add("is-loading");
  $("#loginError").textContent = "";
  try {
    const usernameInput = $("#username") || $("#email");
    const passwordInput = $("#password");
    if (!usernameInput || !passwordInput) throw new Error("로그인 화면이 갱신되었습니다. 페이지를 새로고침해 주세요.");
    if (!/^[A-Za-z0-9._-]{4,30}$/.test(usernameInput.value.trim())) throw new Error("계정 ID는 영문자·숫자·점·밑줄·하이픈으로 입력해 주세요.");
    if (!/^[\x20-\x7E]+$/.test(passwordInput.value)) throw new Error("비밀번호는 영문 자판으로 입력해 주세요.");
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
  $("#mainNav").innerHTML = menuGroups.filter((group) => group.id !== "admin" || currentUser?.role === "admin").map((group) => `
    <section class="nav-section">
      <div class="nav-heading">${group.label}</div>
      ${group.items.map((item) => {
        const hasChildren = Boolean(item.children?.length);
        if (item.url && !hasChildren) return `<a class="nav-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><span class="nav-icon">${escapeHtml(item.icon || "◇")}</span><span>${escapeHtml(item.title)}</span><span class="chevron">↗</span></a>`;
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
  if (["admin", "calendar_admin"].includes(page) && currentUser?.role !== "admin") {
    page = "dashboard";
    showToast("관리자 전용 메뉴입니다.");
  }
  currentPage = page;
  clearInterval(carouselTimer);
  pageContent.classList.toggle("dashboard-page", page === "dashboard");
  renderNavigation();
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.nav === page));
  const title = menuGroups.flatMap((g) => g.items).find((item) => item.id === page)?.title || "통합 대시보드";
  $("#breadcrumbText").textContent = title;
  if (page === "dashboard") renderDashboard();
  else if (page === "admin") renderAdmin();
  else if (page === "calendar") renderCalendarPage();
  else if (page === "calendar_admin") renderCalendarSettings();
  else renderPlaceholder(title, page);
  closeSidebar();
};

const calendarKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const resetCalendarToToday = () => {
  const today = new Date();
  calendarMonth = new Date(today.getFullYear(),today.getMonth(),1);
  selectedCalendarDateKey = calendarKey(today);
};
const eventDateKey = (event) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(event.start || "")) return event.start;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(event.start));
};
const renderCalendarDays = (events = [], selectedKey = "") => {
  const heads = ["일", "월", "화", "수", "목", "금", "토"].map((d) => `<div class="day-head">${d}</div>`).join("");
  const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - first.getDay());
  const todayKey = calendarKey(new Date());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart); date.setDate(gridStart.getDate() + index);
    const key = calendarKey(date);
    const dayEvents = events.filter((event) => eventDateKey(event) === key);
    const muted = date.getMonth() !== calendarMonth.getMonth();
    return `<button type="button" class="calendar-date ${muted ? "muted-day" : ""} ${key === todayKey ? "today-day" : ""} ${key === selectedKey ? "selected-day" : ""}" data-calendar-date="${key}" aria-label="${date.getMonth() + 1}월 ${date.getDate()}일 일정 ${dayEvents.length}건">${date.getDate()}${dayEvents.slice(0,2).map((event) => `<span class="event-dot" style="--event-color:${escapeHtml(event.calendar_color || "#0a9b7e")};--event-foreground:${escapeHtml(event.calendar_foreground || "#ffffff")}" title="${escapeHtml(event.calendar_name || "Google Calendar")}">${escapeHtml(event.title)}</span>`).join("")}${dayEvents.length > 2 ? `<small class="more-events">+${dayEvents.length - 2}</small>` : ""}</button>`;
  }).join("");
  return heads + days;
};

const renderCalendarView = async () => {
  const body = $("#carouselBody");
  if (!body || carouselMode !== "calendar") return;
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth() + 1;
  body.innerHTML = `<div class="calendar-loading"><span class="spinner"></span><p>Google Calendar 일정을 불러오는 중입니다.</p></div>`;
  try {
    const response = await fetch(`/api/calendar/events?month=${year}-${String(month).padStart(2,"0")}`, { headers: { accept: "application/json" } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    const events = result.events || [];
    const today = new Date();
    const todayCount = $("#todayScheduleCount");
    if (todayCount && today.getFullYear() === year && today.getMonth() === month - 1) todayCount.textContent = events.filter((event) => eventDateKey(event) === calendarKey(today)).length;
    const monthPrefix = `${year}-${String(month).padStart(2,"0")}`;
    const initialDate = selectedCalendarDateKey?.startsWith(monthPrefix)
      ? new Date(`${selectedCalendarDateKey}T12:00:00`)
      : (today.getFullYear() === year && today.getMonth() === month - 1 ? today : new Date(year,month - 1,1));
    const drawSelectedDate = (focusKey) => {
      selectedCalendarDateKey = focusKey;
      const focusDate = new Date(`${focusKey}T12:00:00`);
      const focusEvents = events.filter((event) => eventDateKey(event) === focusKey);
      const focusLabel = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(focusDate);
      const scheduleHtml = focusEvents.length ? focusEvents.map((event) => {
        const start = event.all_day ? "종일" : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.start));
        const end = event.all_day || !event.end ? "" : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.end));
        return `<article class="schedule-item" style="--event-color:${escapeHtml(event.calendar_color || "#0a9b7e")}"><time>${escapeHtml(start)}${end ? ` - ${escapeHtml(end)}` : ""}</time><b>${escapeHtml(event.title)}</b><span>${event.calendar_color ? `<i class="calendar-color-dot" style="--calendar-color:${escapeHtml(event.calendar_color)}"></i>` : ""}${escapeHtml(event.calendar_name || "Google Calendar")}${event.location ? ` · ${escapeHtml(event.location)}` : ""}</span>${event.description ? `<p>${escapeHtml(event.description)}</p>` : ""}</article>`;
      }).join("") : '<p class="calendar-empty">등록된 일정이 없습니다.</p>';
      body.innerHTML = `<div class="calendar-view main-calendar-view">
        <div class="calendar-area"><div class="calendar-top"><button id="calendarPrev" aria-label="이전 달">‹</button><b>${year}년 ${month}월</b><button id="calendarNext" aria-label="다음 달">›</button></div><div class="calendar-grid">${renderCalendarDays(events, focusKey)}</div></div>
        <aside class="schedule-list" aria-live="polite"><h3>${focusLabel}<small>${focusEvents.length}건</small></h3>${scheduleHtml}<span class="integration-badge ${result.connected ? "connected" : "waiting"}">${result.connected ? `Google Calendar ${result.calendar_count || 1}개 연결 · ${events.length}건` : escapeHtml(result.message || "일정을 불러올 수 없습니다.")}</span></aside>
      </div>`;
      $("#calendarPrev").onclick = () => { selectedCalendarDateKey = null; calendarMonth = new Date(year,month - 2,1); renderCalendarView(); };
      $("#calendarNext").onclick = () => { selectedCalendarDateKey = null; calendarMonth = new Date(year,month,1); renderCalendarView(); };
      body.querySelectorAll("[data-calendar-date]").forEach((button) => button.addEventListener("click", () => {
        const nextDate = new Date(`${button.dataset.calendarDate}T12:00:00`);
        if (nextDate.getFullYear() !== year || nextDate.getMonth() !== month - 1) {
          selectedCalendarDateKey = button.dataset.calendarDate;
          calendarMonth = new Date(nextDate.getFullYear(),nextDate.getMonth(),1);
          renderCalendarView();
        } else drawSelectedDate(button.dataset.calendarDate);
      }));
    };
    drawSelectedDate(calendarKey(initialDate));
  } catch (error) {
    body.innerHTML = `<div class="calendar-error-state"><i>!</i><h3>일정을 불러오지 못했습니다.</h3><p>${escapeHtml(error.message || "잠시 후 다시 시도하거나 관리자에게 문의해 주세요.")}</p></div>`;
  }
};

const koreaMap = `
  <svg class="map-shape" viewBox="0 0 300 390" role="img" aria-label="대한민국 지역별 커버리지 지도">
    <path class="korea-mainland" d="M168 18l27 16 9 34-13 23 27 31-5 38 18 30-16 38-6 34-30 23-13 37-35 30-17-22-2-39-23-25 5-36-14-31 15-38-11-31 27-18 8-35 25-19 9-38z"/>
    <path class="korea-covered" d="M175 205l37-3 19 28-16 38-6 34-30 23-13 37-19 16-15-26 11-48-12-28 16-30z"/>
    <path class="korea-island" d="M198 350l18 7-5 14-17 5-10-10z"/>
  </svg>`;

const worldMap = `
  <svg class="world-map" viewBox="0 0 920 430" role="img" aria-label="국가별 거래처와 매출 현황 세계 지도">
    <g class="map-grid-lines"><path d="M0 108h920M0 215h920M0 322h920M230 0v430M460 0v430M690 0v430"/></g>
    <g class="world-land">
      <path d="M55 81l42-32 72-22 60 8 32 31-16 31-35 14-18 38-42 25-22 45-45-26-25-50z"/>
      <path d="M202 204l36 15 25 48-12 54-25 70-26-31-9-64-25-45z"/>
      <path d="M322 48l28-25 54 4 18 28-28 15-47-3z"/>
      <path d="M398 103l36-27 57 7 25 28 44 7 20 26-22 15-42-7-27 16-36-8-23 25-31-23-28-6-10-29z"/>
      <path d="M432 184l49 6 37 41-15 70-36 73-42-28-27-73 8-57z"/>
      <path d="M529 89l75-42 91 7 45 39 68 21 50 52-28 42-66-1-53-33-41 14-37-20-42 14-25-32-48-5z"/>
      <path d="M710 311l40-26 64 14 24 43-35 35-65-7-24-28z"/>
      <path d="M837 226l15-7 14 23-18 31-14-19z"/>
    </g>
    <g class="world-active">
      <path d="M62 107l92-44 75 21-19 27-18 38-42 25-33-18-37-17z"/>
      <path d="M399 112l43-28 52 9 20 24-25 25-36-5-21 23-37-9z"/>
      <path d="M552 105l78-39 92 15 60 39-17 41-54 13-41 14-37-20-42 14-25-32z"/>
      <path d="M704 311l46-26 64 14 20 36-31 28-65-5z"/>
    </g>
  </svg>`;

const alloCoverageGroups = [
  ["전국", "122 / 780"], ["서울", "22 / 150"], ["경기·인천", "19 / 214"], ["충청·대전", "10 / 69"],
  ["대구·경북", "52 / 86"], ["부산·울산·경남", "19 / 140"], ["호남", "0 / 94"], ["강원·제주", "0 / 27"]
];

const alloCoverageDetails = [
  ["전국", "122 / 780", 16], ["강원", "0 / 20", 0], ["경기", "16 / 170", 9], ["경남", "2 / 62", 3],
  ["경북", "15 / 29", 52], ["광주", "0 / 35", 0], ["대구", "37 / 57", 65], ["대전", "6 / 20", 30],
  ["부산", "10 / 65", 15], ["서울", "22 / 150", 15], ["세종시", "0 / 1", 0], ["울산", "7 / 13", 54],
  ["인천", "3 / 44", 7], ["전남", "0 / 31", 0]
];

const coverageMarkers = [
  [49,24,"target"],[52,26,"target"],[47,27,"a"],[54,29,"conflict"],[45,30,"target"],[50,32,"target"],
  [44,35,"a"],[57,37,"b"],[51,43,"target"],[47,49,"a"],[55,53,"target"],[60,57,"conflict"],
  [54,61,"target"],[58,63,"target"],[62,65,"conflict"],[59,68,"target"],[69,70,"target"],[66,73,"a"],
  [72,76,"target"],[65,79,"conflict"],[54,74,"b"],[43,70,"a"],[39,77,"a"],[48,84,"b"]
];

const globalMarketPoints = [
  [21,38,"3","sales"],[49,29,"5","partner"],[53,36,"2","sales"],[57,42,"4","partner"],
  [61,48,"6","fcst"],[67,37,"2","sales"],[73,44,"5","partner"],[79,55,"8","partner"],
  [85,61,"3","partner"],[88,78,"1","partner"],[30,73,"1","partner"],[76,67,"2","sales"]
];

const carouselModes = ["calendar", "allo", "global"];
const carouselMeta = {
  calendar: ["메드파크 주요 일정", "회사 주요 일정과 오늘의 일정을 함께 확인합니다."],
  allo: ["MedPark-Allo · 전국 지역별 커버리지", "국내영업 시스템의 지역별 커버리지 구조를 요약합니다."],
  global: ["Global Market Action Map", "국가별 거래처 FSCT ERP 확정매출 구조를 요약합니다."]
};

const renderCarousel = () => {
  const body = $("#carouselBody");
  if (!body) return;
  $$('[data-carousel]').forEach((button) => button.classList.toggle("active", button.dataset.carousel === carouselMode));
  const [title, subtitle] = carouselMeta[carouselMode];
  $("#carouselTitle").textContent = title;
  $("#carouselSubtitle").textContent = subtitle;
  if (carouselMode === "calendar") renderCalendarView();
  else if (carouselMode === "allo") body.innerHTML = `
    <section class="dashboard-grid allo-dashboard-grid">
      <div class="coverage-filter-strip">${alloCoverageGroups.map(([region, count], index) => `<span class="coverage-chip${index === 0 ? " active" : ""}"><b>${region}</b><small>${count}</small></span>`).join("")}</div>
      <div class="coverage-map-stage">
        <div class="map-legend"><span><i class="area"></i>지역 커버리지</span><span><i class="target"></i>확보 타깃</span><span><i class="a"></i>미공략 A급</span><span><i class="b"></i>미공략 B급</span><span><i class="conflict"></i>업체 충돌</span></div>
        ${koreaMap}
        ${coverageMarkers.map(([left,top,type]) => `<i class="coverage-marker ${type}" style="--left:${left}%;--top:${top}%"></i>`).join("")}
      </div>
      <aside class="coverage-regions"><div class="source-row"><span class="authenticated-source">관리자 로그인 확인</span><a href="https://medprk-medpark-allo.mycafe24.ai/" target="_blank" rel="noopener noreferrer">MedPark-Allo 열기 ↗</a></div>
        ${alloCoverageDetails.map(([region,count,percent], index) => `<div class="coverage-item${index === 0 ? " total" : ""}"><div><b>${region}</b><span>${count}</span></div><strong>${percent}%</strong><i><em style="width:${percent}%"></em></i></div>`).join("")}
      </aside>
    </section>`;
  else body.innerHTML = `
    <article class="panel span-12 global-map-panel">
      <div class="global-kpi-strip">
        <div><span>활동 국가</span><b>50국</b><small>거래처 99개</small></div><div><span>선택월 전체 FCST</span><b>₩0</b><small>지도 매칭 ₩0</small></div><div><span>ERP 확정매출</span><b>₩0</b><small>지도 매칭 ₩0</small></div><div><span>미결 후속조치</span><b>15건</b><small>기한 초과 2건</small></div>
      </div>
      <div class="global-market-stage">
        ${worldMap}
        ${globalMarketPoints.map(([left,top,count,type]) => `<i class="global-marker ${type}" style="--left:${left}%;--top:${top}%">${count}</i>`).join("")}
        <div class="global-map-legend"><span><i class="erp"></i>ERP 출고 확정</span><span><i class="fcst"></i>FCST 진행</span><span><i class="sales"></i>영업추진</span><span><i class="partner"></i>거래처 등록</span></div>
      </div>
      <aside class="country-sales"><div class="source-row"><span class="authenticated-source">관리자 로그인 확인</span><a href="https://medprk-medpark-global-maps.mycafe24.ai/" target="_blank" rel="noopener noreferrer">Global-MAPS 열기 ↗</a></div>
        <div class="selected-country"><span>중동</span><b>사우디아라비아</b><small>Saudi Arabia · 영업 추진</small></div>
        <div class="country-sales-metrics"><div><span>전체 FCST</span><b>₩0</b></div><div><span>ERP 확정</span><b>₩0</b></div><div><span>거래처</span><b>6</b></div><div><span>미결</span><b>1</b></div></div>
        <div class="sales-heading"><h3>국가별 거래처·FCST·ERP</h3><small>세부 데이터는 원본 시스템에서 확인합니다.</small></div>
        <div class="country-row"><i>SA</i><div><b>사우디아라비아</b><span>거래처 6 · 영업 추진</span></div><strong>선택</strong></div>
        <div class="country-row"><i>US</i><div><b>미국</b><span>북미 거래처 현황</span></div><strong>3</strong></div>
        <div class="country-row"><i>CN</i><div><b>중국</b><span>아시아 거래처 현황</span></div><strong>8</strong></div>
      </aside>
    </article>`;
  $("#carouselProgress").innerHTML = "<i></i>";
  $$('[data-carousel]').forEach((button) => button.onclick = () => { carouselMode = button.dataset.carousel; renderCarousel(); startCarousel(); });
};

const startCarousel = () => {
  clearInterval(carouselTimer);
  carouselTimer = setInterval(() => {
    carouselMode = carouselModes[(carouselModes.indexOf(carouselMode) + 1) % carouselModes.length];
    renderCarousel();
  }, 30000);
};

const renderQuickLinks = () => {
  const list = $("#quickLinksList");
  if (!list) return;
  list.innerHTML = quickLinks.map((link) => `<a class="quick-link-compact" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"><i>${escapeHtml(link.icon)}</i><span>${escapeHtml(link.label)}</span><b>↗</b></a>`).join("") || '<p class="quick-empty">선택한 시스템이 없습니다.</p>';
};

const openQuickLinksEditor = () => {
  const selected = new Set(quickLinks.map((link) => link.id));
  $("#quickLinksOptions").innerHTML = quickLinkCatalog.map((link) => `<label><input type="checkbox" name="system_id" value="${escapeHtml(link.id)}" ${selected.has(link.id) ? "checked" : ""} /><i>${escapeHtml(link.icon)}</i><span><b>${escapeHtml(link.label)}</b><small>${escapeHtml(new URL(link.url).hostname)}</small></span></label>`).join("");
  $("#quickLinksError").textContent = "";
  quickLinksDialog.showModal();
};

const renderDashboard = () => {
  resetCalendarToToday();
  carouselMode = "calendar";
  pageContent.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">OVERVIEW</span><h1>안녕하세요, ${currentUser?.name || "임직원"}님</h1><p>주요 일정과 국내·해외 사업 현황을 한눈에 확인하세요.</p></div><span class="live-status"><i></i> 시스템 정상 운영 중</span></section>
    <section class="dashboard-top-grid">
      <article class="panel main-carousel-panel">
        <header class="panel-header dashboard-carousel-header"><div><h2 id="carouselTitle">메드파크 주요 일정</h2><p id="carouselSubtitle">회사 주요 일정과 오늘의 일정을 함께 확인합니다.</p></div><div class="segmented"><button data-carousel="calendar" class="active">일정</button><button data-carousel="allo">MedPark-Allo</button><button data-carousel="global">Global MAP</button></div></header>
        <div id="carouselBody" class="carousel-body"></div><div id="carouselProgress" class="carousel-progress"><i></i></div>
      </article>
      <aside class="dashboard-side-vertical">
        <article class="metric-card compact-metric"><i class="metric-icon">□</i><div><span>오늘의 일정</span><strong><b id="todayScheduleCount">0</b><small>건 예정</small></strong></div></article>
        <article class="metric-card compact-metric"><i class="metric-icon">☷</i><div><span>새 회의록</span><strong>5<small>건 등록</small></strong></div></article>
        <article class="panel quick-compact-panel"><header class="panel-header"><div><h2>자주 찾는 시스템</h2><p>나만의 바로가기</p></div><button id="editQuickLinks" class="mini-edit-button">편집</button></header><div id="quickLinksList" class="quick-list-vertical"></div></article>
      </aside>
    </section>`;
  renderQuickLinks();
  $("#editQuickLinks").addEventListener("click", openQuickLinksEditor);
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

const orderButtonsMarkup = () => `<span class="category-order-actions"><button type="button" class="category-order-move" data-direction="up" aria-label="위로 이동">↑</button><button type="button" class="category-order-move" data-direction="down" aria-label="아래로 이동">↓</button></span>`;

const orderItemMarkup = (item) => `<article class="category-order-item" data-order-row data-order-id="${escapeHtml(item.id)}">
  <div><span><i>${escapeHtml(item.icon || "◇")}</i>${escapeHtml(item.title)}</span>${orderButtonsMarkup()}</div>
  ${(item.children || []).length ? `<div class="category-order-list nested" data-order-scope="${escapeHtml(item.id)}">${item.children.map((child) => `<article class="category-order-item child" data-order-row data-order-id="${escapeHtml(child.id)}"><div><span>${escapeHtml(child.title)}</span>${orderButtonsMarkup()}</div></article>`).join("")}</div>` : ""}
</article>`;

const menuOrderMarkup = () => `<section class="menu-order-panel">
  <div><span class="eyebrow">MENU ORDER</span><h2>카테고리 순서 관리</h2><p>각 단계에서 위·아래 버튼으로 표시 순서를 변경합니다.</p></div>
  <div class="category-order-list root" data-order-scope="root">${configurableMenuGroups().map((group) => `<article class="category-order-group" data-order-row data-order-id="${escapeHtml(group.id)}">
    <header><b>${escapeHtml(group.label)}</b>${orderButtonsMarkup()}</header>
    <div class="category-order-list" data-order-scope="${escapeHtml(group.id)}">${group.items.map(orderItemMarkup).join("")}</div>
  </article>`).join("")}</div>
</section>`;

const moveCategoryOrder = (event) => {
  const row = event.target.closest("[data-order-row]");
  const list = row?.parentElement;
  if (!row || !list?.matches("[data-order-scope]")) return;
  if (event.currentTarget.dataset.direction === "up" && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
  if (event.currentTarget.dataset.direction === "down" && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
};

const collectMenuOrder = () => Object.fromEntries($$("[data-order-scope]").map((list) => [
  list.dataset.orderScope,
  [...list.children].filter((child) => child.matches("[data-order-row]")).map((child) => child.dataset.orderId)
]));

const updateMenuCreateParentOptions = () => {
  const groupSelect = $("#menuCreateGroup");
  const parentSelect = $("#menuCreateParent");
  if (!groupSelect || !parentSelect) return;
  const group = menuGroups.find((candidate) => candidate.id === groupSelect.value);
  parentSelect.innerHTML = `<option value="">${escapeHtml(group?.label || "선택한 최상단")} 바로 아래</option>${(group?.items || []).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)} 하위</option>`).join("")}`;
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
          <div class="menu-manager-heading"><div><h2>카테고리 이름 관리</h2><p>최상위·상위·하위 카테고리 이름과 표시 순서를 함께 관리합니다.</p></div><button class="button primary" type="submit">이름·순서 저장</button></div>
          <section class="menu-group-name-editor">
            <h3>최상위 카테고리</h3>
            <div class="menu-group-name-grid">${configurableMenuGroups().map((group) => `
              <label><span>${escapeHtml(group.id.toUpperCase())}</span><input name="group_${escapeHtml(group.id)}" value="${escapeHtml(group.label)}" minlength="1" maxlength="40" required /></label>`).join("")}
            </div>
          </section>
          <div class="menu-label-groups">${editableTopMenuItems().map((parent) => `
            <section class="menu-edit-group">
              <label class="top-menu-label"><span>상위 카테고리</span><input name="${escapeHtml(parent.id)}" value="${escapeHtml(parent.title)}" minlength="1" maxlength="40" required /></label>
              <div class="child-menu-list">${(parent.children || []).length ? parent.children.map((child) => `
                <label><span>하위 카테고리${child.url ? ` · 연결됨` : ""}</span><input name="${escapeHtml(child.id)}" value="${escapeHtml(child.title)}" minlength="1" maxlength="40" required /></label>`).join("") : '<p class="empty-child-menu">등록된 하위 카테고리가 없습니다.</p>'}</div>
            </section>`).join("")}</div>
          <p id="menuLabelsError" class="form-error"></p>
        </form>
        <aside class="menu-admin-side">
          ${menuOrderMarkup()}
          <form id="menuCreateForm" class="menu-create-form">
            <div><span class="eyebrow">NEW CATEGORY</span><h2>카테고리 등록</h2><p>소속 최상단을 지정한 뒤 바로 아래 또는 기존 카테고리 하위에 추가합니다. ADMIN은 고정 영역입니다.</p></div>
            <label>최상단 카테고리<select id="menuCreateGroup" name="group_id" required>${configurableMenuGroups().map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.label)}</option>`).join("")}</select></label>
            <label>등록 위치<select id="menuCreateParent" name="parent_id"></select></label>
            <label>카테고리 이름<input name="label" minlength="1" maxlength="40" placeholder="새 카테고리 이름" required /></label>
            <label>연결 URL <small>선택</small><input name="url" type="url" placeholder="https://" /></label>
            <label>아이콘 <small>선택 · 최상단 바로 아래 등록용</small><input name="icon" maxlength="2" placeholder="◇" /></label>
            <p id="menuCreateError" class="form-error"></p>
            <button class="button primary full" type="submit">＋ 카테고리 등록</button>
          </form>
        </aside>
      </div>`;
    $("#menuLabelsForm").addEventListener("submit", saveMenuLabels);
    $("#menuCreateForm").addEventListener("submit", createMenuItem);
    $("#menuCreateGroup").addEventListener("change", updateMenuCreateParentOptions);
    updateMenuCreateParentOptions();
    $$(".category-order-move").forEach((button) => button.addEventListener("click", moveCategoryOrder));
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
    const orderResponse = await fetch("/api/admin/menu/order", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scopes: collectMenuOrder() }) });
    const orderedResult = await orderResponse.json();
    if (!orderResponse.ok) throw new Error(orderedResult.message);
    applyMenuConfig(orderedResult);
    renderNavigation();
    $("#breadcrumbText").textContent = "포털 관리";
    renderAdminTab("menus");
    showToast("카테고리 이름과 순서가 저장되었습니다.");
  } catch (error) {
    $("#menuLabelsError").textContent = error.message || "카테고리 이름과 순서 저장에 실패했습니다.";
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
$$('[data-close-quick-links]').forEach((button) => button.addEventListener("click", () => quickLinksDialog.close()));
$("#quickLinksForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const ids = [...event.currentTarget.querySelectorAll('input[name="system_id"]:checked')].map((input) => input.value);
  $("#quickLinksError").textContent = "";
  if (!ids.length || ids.length > 5) {
    $("#quickLinksError").textContent = "자주 찾는 시스템을 1개 이상 5개 이하로 선택해 주세요.";
    return;
  }
  try {
    const response = await fetch("/api/quick-links", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system_ids: ids })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    quickLinks = result.links || [];
    quickLinkCatalog = result.catalog || quickLinkCatalog;
    quickLinksDialog.close();
    renderQuickLinks();
    showToast("나만의 자주 찾는 시스템이 저장되었습니다.");
  } catch (error) {
    $("#quickLinksError").textContent = error.message || "자주 찾는 시스템 저장에 실패했습니다.";
  }
});
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

const calendarPickerMarkup = (calendars = []) => calendars.length ? calendars.map((calendar) => `
  <label class="calendar-choice">
    <input type="checkbox" name="calendar_selection" value="${escapeHtml(calendar.calendar_id)}" ${calendar.selected !== false ? "checked" : ""} />
    <i style="--calendar-color:${escapeHtml(calendar.background_color || "#0a9b7e")}"></i>
    <span><b>${escapeHtml(calendar.summary || calendar.calendar_id)}</b><small>${calendar.primary_calendar ? "기본 캘린더 · " : ""}${escapeHtml(calendar.access_role || "reader")} · ${escapeHtml(calendar.calendar_id)}</small></span>
  </label>`).join("") : '<p class="calendar-picker-empty">Google 계정 승인 후 ‘캘린더 목록 불러오기’를 눌러 주세요.</p>';

const calendarSettingsMarkup = (settings) => `
  <section class="calendar-settings-layout">
    <article class="calendar-connection-card">
      <span class="connection-light ${settings.connected ? "on" : ""}"></span>
      <div><span>연결 상태</span><b>${settings.connected ? "Google Calendar 연결됨" : settings.configured ? "설정 저장됨 · 연결 확인 필요" : "연결되지 않음"}</b><small>${escapeHtml(settings.calendar_id || "medpark.remote@gmail.com")}</small></div>
    </article>
    <form id="calendarSettingsForm" class="calendar-settings-form">
      <div class="settings-section-heading"><span class="eyebrow">GOOGLE CALENDAR</span><h2>연결 방식 설정</h2><p>API 키는 공개 캘린더용이며, 비공개 캘린더는 OAuth 2.0 승인이 필요합니다.</p></div>
      <label>연결 방식<select name="mode" id="calendarMode"><option value="api_key" ${settings.mode !== "oauth" ? "selected" : ""}>API 키 · 공개 캘린더</option><option value="oauth" ${settings.mode === "oauth" ? "selected" : ""}>OAuth 2.0 · 비공개 캘린더</option></select></label>
      <label>Google 캘린더 ID<input name="calendar_id" value="${escapeHtml(settings.calendar_id || "medpark.remote@gmail.com")}" maxlength="255" required /><small>기본 캘린더는 보통 Google 계정 이메일과 같습니다.</small></label>
      <div id="apiKeyFields" class="calendar-mode-fields">
        <label>Calendar API 키<input name="api_key" type="password" autocomplete="new-password" placeholder="${settings.api_key_saved ? "저장된 API 키 유지" : "AIza..."}" /><small>Google Cloud에서 Calendar API를 활성화하고 생성한 키를 입력합니다.</small></label>
      </div>
      <div id="oauthFields" class="calendar-mode-fields">
        <label>OAuth 2.0 Client ID<input name="oauth_client_id" value="${escapeHtml(settings.oauth_client_id || "")}" placeholder="...apps.googleusercontent.com" /><small>애플리케이션 유형은 ‘웹 애플리케이션’으로 생성합니다.</small></label>
        <label>OAuth 2.0 Client Secret<input name="oauth_client_secret" type="password" autocomplete="new-password" placeholder="${settings.oauth_client_secret_saved ? "저장된 Client Secret 유지" : "GOCSPX-..."}" /></label>
        <label>승인된 리디렉션 URI<input value="${escapeHtml(settings.redirect_uri)}" readonly /><small>Google Cloud OAuth 클라이언트에 이 주소를 정확히 등록해야 합니다.</small></label>
        <label>요청 권한<input value="읽기 전용 · calendar.readonly" readonly /></label>
        <section class="calendar-picker-section">
          <div class="calendar-picker-heading"><div><b>표시할 캘린더</b><small>연결 계정에서 읽을 수 있는 캘린더를 여러 개 선택할 수 있습니다.</small></div><button type="button" id="loadCalendarList" class="button secondary">캘린더 목록 불러오기</button></div>
          <div class="calendar-picker-actions"><button type="button" id="selectAllCalendars">전체 선택</button><button type="button" id="clearCalendarSelection">선택 해제</button><span id="calendarSelectionCount">${(settings.selected_calendars || []).length}개 선택</span></div>
          <div id="calendarPickerList" class="calendar-picker-list">${calendarPickerMarkup(settings.selected_calendars || [])}</div>
          <button type="button" id="saveCalendarSelection" class="button primary full" ${(settings.selected_calendars || []).length ? "" : "disabled"}>선택한 캘린더 저장</button>
        </section>
      </div>
      <p id="calendarSettingsError" class="form-error"></p>
      <footer><button type="button" id="testCalendar" class="button secondary">연결 테스트</button><button type="submit" class="button primary">설정 저장</button><button type="button" id="authorizeCalendar" class="button primary">Google 계정 승인</button></footer>
    </form>
  </section>`;

const updateCalendarModeFields = () => {
  const mode = $("#calendarMode")?.value;
  if (!mode) return;
  $("#apiKeyFields").hidden = mode !== "api_key";
  $("#oauthFields").hidden = mode !== "oauth";
  $("#authorizeCalendar").hidden = mode !== "oauth";
};

const updateCalendarSelectionCount = () => {
  const choices = $$('[name="calendar_selection"]');
  const selected = choices.filter((input) => input.checked).length;
  const count = $("#calendarSelectionCount");
  if (count) count.textContent = `${selected}개 선택`;
  const save = $("#saveCalendarSelection");
  if (save) save.disabled = selected === 0;
};

const bindCalendarPicker = () => {
  $("#calendarPickerList")?.addEventListener("change", updateCalendarSelectionCount);
  $("#selectAllCalendars")?.addEventListener("click", () => { $$('[name="calendar_selection"]').forEach((input) => { input.checked = true; }); updateCalendarSelectionCount(); });
  $("#clearCalendarSelection")?.addEventListener("click", () => { $$('[name="calendar_selection"]').forEach((input) => { input.checked = false; }); updateCalendarSelectionCount(); });
  $("#loadCalendarList")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    $("#calendarSettingsError").textContent = "";
    $("#calendarPickerList").innerHTML = '<div class="calendar-loading compact"><span class="spinner"></span><p>사용 가능한 캘린더를 불러오는 중입니다.</p></div>';
    try {
      const response = await fetch("/api/admin/calendar/calendars", { headers: { accept: "application/json" } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      $("#calendarPickerList").innerHTML = calendarPickerMarkup(result.calendars || []);
      updateCalendarSelectionCount();
    } catch (error) {
      $("#calendarPickerList").innerHTML = '<p class="calendar-picker-empty">캘린더 목록을 불러오지 못했습니다.</p>';
      $("#calendarSettingsError").textContent = error.message || "캘린더 목록을 불러오지 못했습니다.";
    } finally { button.disabled = false; }
  });
  $("#saveCalendarSelection")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const calendarIds = $$('[name="calendar_selection"]:checked').map((input) => input.value);
    button.disabled = true;
    $("#calendarSettingsError").textContent = "";
    try {
      const response = await fetch("/api/admin/calendar/calendars", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ calendar_ids: calendarIds }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      showToast(`${result.selected_calendars.length}개 캘린더가 저장되었습니다.`);
      await loadCalendarSettingsPage();
    } catch (error) {
      $("#calendarSettingsError").textContent = error.message || "캘린더 선택 저장에 실패했습니다.";
      button.disabled = false;
    }
  });
};

const loadCalendarSettingsPage = async () => {
  const host = $("#calendarSettingsHost");
  if (!host) return;
  try {
    const response = await fetch("/api/admin/calendar/settings", { headers: { accept: "application/json" } });
    const settings = await response.json();
    if (!response.ok) throw new Error(settings.message);
    host.innerHTML = calendarSettingsMarkup(settings);
    updateCalendarModeFields();
    bindCalendarPicker();
    $("#calendarMode").addEventListener("change", updateCalendarModeFields);
    $("#calendarSettingsForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(event.currentTarget));
      $("#calendarSettingsError").textContent = "";
      try {
        const saveResponse = await fetch("/api/admin/calendar/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const result = await saveResponse.json();
        if (!saveResponse.ok) throw new Error(result.message);
        showToast("Google Calendar 연결 설정이 안전하게 저장되었습니다.");
        await loadCalendarSettingsPage();
      } catch (error) { $("#calendarSettingsError").textContent = error.message || "설정 저장에 실패했습니다."; }
    });
    $("#testCalendar").addEventListener("click", async () => {
      $("#calendarSettingsError").textContent = "";
      try {
        const testResponse = await fetch("/api/admin/calendar/test", { method: "POST" });
        const result = await testResponse.json();
        if (!testResponse.ok) throw new Error(result.message);
        showToast(result.message);
      } catch (error) { $("#calendarSettingsError").textContent = error.message || "연결 테스트에 실패했습니다."; }
    });
    $("#authorizeCalendar").addEventListener("click", async () => {
      $("#calendarSettingsError").textContent = "";
      try {
        const authResponse = await fetch("/api/admin/calendar/oauth/start", { method: "POST" });
        const result = await authResponse.json();
        if (!authResponse.ok) throw new Error(result.message);
        location.assign(result.authorization_url);
      } catch (error) { $("#calendarSettingsError").textContent = error.message || "Google 승인을 시작하지 못했습니다."; }
    });
  } catch (error) { host.innerHTML = `<div class="calendar-error-state"><i>!</i><h3>연결 설정을 불러오지 못했습니다.</h3><p>${escapeHtml(error.message || "다시 시도해 주세요.")}</p></div>`; }
};

const renderCalendarSettings = () => {
  pageContent.innerHTML = `<section class="page-heading"><div><span class="eyebrow">ADMINISTRATION</span><h1>일정(캘린더)_관리자</h1><p>Google Calendar 일정 조회와 인증 방식을 관리합니다.</p></div><button id="backToDashboard" class="button secondary">일정으로 돌아가기</button></section><section class="content-panel calendar-settings-panel"><div id="calendarSettingsHost">${currentUser?.role === "admin" ? '<div class="calendar-loading"><span class="spinner"></span><p>연결 설정을 불러오는 중입니다.</p></div>' : '<div class="placeholder-state"><div><i>□</i><h2>Google Calendar</h2><p>연결 설정은 관리자만 변경할 수 있습니다.</p></div></div>'}</div></section>`;
  $("#backToDashboard").addEventListener("click", () => navigate("calendar"));
  if (currentUser?.role === "admin") loadCalendarSettingsPage();
};

const renderCalendarPage = () => {
  resetCalendarToToday();
  pageContent.innerHTML = `<section class="page-heading"><div><span class="eyebrow">COLLABORATION</span><h1>일정(캘린더)</h1><p>메드파크 주요 일정을 월별로 확인합니다.</p></div></section><section class="panel standalone-calendar-panel"><div id="carouselBody" class="carousel-body"></div></section>`;
  carouselMode = "calendar";
  renderCalendarView();
};

const openSidebar = () => { $("#sidebar").classList.add("open"); $("#sidebarBackdrop").classList.add("open"); };
const closeSidebar = () => { $("#sidebar").classList.remove("open"); $("#sidebarBackdrop").classList.remove("open"); };
$("#openSidebar").addEventListener("click", openSidebar);
$("#closeSidebar").addEventListener("click", closeSidebar);
$("#sidebarBackdrop").addEventListener("click", closeSidebar);

const setupSearch = () => {
  const draw = (query = "") => {
    const visibleGroups = menuGroups.filter((group) => group.id !== "admin" || currentUser?.role === "admin");
    const allItems = visibleGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
    const items = allItems.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));
    $("#searchResults").innerHTML = items.map((item) => item.url
      ? `<a class="search-result" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><b>${escapeHtml(item.icon)} &nbsp; ${escapeHtml(item.title)}</b><span>${escapeHtml(item.group)} · 새 탭</span></a>`
      : `<button type="button" class="search-result" data-search-page="${escapeHtml(item.id)}"><b>${escapeHtml(item.icon)} &nbsp; ${escapeHtml(item.title)}</b><span>${escapeHtml(item.group)}</span></button>`).join("") || '<div style="padding:30px;text-align:center;color:#8a9693;font-size:11px">검색 결과가 없습니다.</div>';
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
  await Promise.all([loadMenuConfig(), loadQuickLinks()]);
  const now = new Date();
  $("#todayLabel").textContent = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(now);
  $(".profile b").textContent = currentUser?.name || "임직원";
  $(".profile small").textContent = `${currentUser?.department || "소속 미지정"} · ${currentUser?.role === "admin" ? "관리자" : "임직원"}`;
  $(".profile .avatar").textContent = (currentUser?.name || "M").slice(0, 1);
  renderNavigation();
  const calendarResult = new URLSearchParams(location.search).get("calendar");
  navigate(calendarResult && currentUser?.role === "admin" ? "calendar" : "dashboard");
  if (calendarResult) {
    showToast(calendarResult === "connected" ? "Google Calendar 계정 승인이 완료되었습니다." : "Google Calendar 계정 승인이 취소되었습니다.");
    history.replaceState({}, "", location.pathname);
  }
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
