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
    { id: "tf", icon: "T", title: "TF", children: [
      { id: "tf_ar", title: "미수채권", url: "https://medprk-ar-dashboard.mycafe24.ai/" }
    ]},
    { id: "amarans", icon: "A", title: "아마란스", url: "https://gw.medpark.kr/" },
    { id: "meetings", icon: "☷", title: "회의록", children: [
      { id: "meetings_openai", title: "회의록_OpenAI", url: null },
      { id: "meetings_plaud", title: "회의록_Plaud", url: null }
    ]},
    { id: "calendar", icon: "□", title: "일정(캘린더)" }
  ]},
  { id: "admin", label: "ADMIN", items: [
    { id: "admin", icon: "⚙", title: "포털 관리" },
    { id: "admin_calendar", icon: "□", title: "일정(캘린더)_관리자" },
  ]}
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const isInternalUrl = (url) => typeof url === "string" && url.startsWith("/") && !url.startsWith("//");
const linkAttributes = (url) => isInternalUrl(url) ? "" : ' target="_blank" rel="noopener noreferrer"';
const linkIndicator = (url) => isInternalUrl(url) ? "→" : "↗";
const linkLocation = (url) => isInternalUrl(url) ? "MedPark One 내부" : new URL(url).hostname;
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
let carouselPaused = false;
let currentUser = null;
let calendarMonth = new Date();
let selectedCalendarDateKey = null;
let employeeCache = [];
let editingEmployeeId = null;
let quickLinks = [];
let quickLinkCatalog = [];
const CALENDAR_EVENT_CACHE_MS = 5 * 60 * 1000;
const calendarEventCache = new Map();
const calendarEventRequests = new Map();
let calendarRenderRequestId = 0;

let plaudPollTimer = null;
let plaudSelectedFile = null;
let plaudStatusFilter = "";
let plaudSearchQuery = "";
let plaudConfig = null;
let plaudPageLoading = false;

const plaudRequest = async (url, options = {}) => {
  const headers = { accept: "application/json", ...(options.headers || {}) };
  if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const response = await fetch(url, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "요청을 처리하지 못했습니다.");
  return result;
};

const formatPlaudFileSize = (bytes) => {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
};

const formatPlaudDuration = (seconds) => {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  if (!value) return "-";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remain = value % 60;
  return hours ? `${hours}시간 ${minutes}분` : `${minutes}분 ${remain}초`;
};

const formatPlaudDate = (value) => value
  ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
  : "-";

const plaudStatusMeta = (status) => ({
  completed: { label: "완료", className: "completed" },
  processing: { label: "처리 중", className: "processing" },
  failed: { label: "실패", className: "failed" },
  uploading: { label: "업로드 중", className: "processing" },
}[status] || { label: "대기", className: "waiting" });

const updatePlaudProgress = (percent, message, tone = "") => {
  const host = $("#plaudUploadProgress");
  if (!host) return;
  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent || 0))));
  host.hidden = false;
  host.className = `plaud-upload-progress ${tone}`.trim();
  host.innerHTML = `<div><span>${escapeHtml(message)}</span><b>${safePercent}%</b></div><progress max="100" value="${safePercent}"></progress>`;
};

const setPlaudFile = (file) => {
  const summary = $("#plaudFileSummary");
  const submit = $("#plaudUploadButton");
  if (!file) {
    plaudSelectedFile = null;
    if (summary) summary.innerHTML = "<b>녹음파일을 선택해 주세요.</b><span>MP3 또는 OPUS · 최대 2GB</span>";
    if (submit) submit.disabled = true;
    return;
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["mp3", "opus"].includes(extension)) {
    showToast("현재 PLAUD 직접 업로드는 MP3 또는 OPUS 파일만 지원합니다.");
    setPlaudFile(null);
    return;
  }
  const maxSize = Number(plaudConfig?.max_file_size || 2 * 1024 ** 3);
  if (!file.size || file.size > maxSize) {
    showToast("파일 크기는 2GB 이하여야 합니다.");
    setPlaudFile(null);
    return;
  }
  plaudSelectedFile = file;
  if (summary) summary.innerHTML = `<b>${escapeHtml(file.name)}</b><span>${formatPlaudFileSize(file.size)} · ${extension.toUpperCase()}</span>`;
  const titleInput = $("#plaudTitleInput");
  if (titleInput && !titleInput.value.trim()) titleInput.value = file.name.replace(/\.[^.]+$/, "");
  if (submit) submit.disabled = !plaudConfig?.configured;
};

const renderPlaudRows = (items = [], total = 0) => {
  const body = $("#plaudMeetingRows");
  const count = $("#plaudBoardCount");
  if (count) count.textContent = `${Number(total || 0).toLocaleString("ko-KR")}건`;
  if (!body) return;
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="plaud-empty"><i>☷</i><b>등록된 회의록이 없습니다.</b><span>녹음파일을 업로드하면 처리 현황이 이곳에 표시됩니다.</span></div></td></tr>';
    return;
  }
  body.innerHTML = items.map((item) => {
    const status = plaudStatusMeta(item.status);
    return `<tr>
      <td><div class="plaud-masked-title"><b>${escapeHtml(item.masked_title)}</b><small>제목 마스킹 적용</small></div></td>
      <td><span class="plaud-status ${status.className}"><i></i>${status.label}</span></td>
      <td>${formatPlaudDuration(item.duration_seconds)}</td>
      <td>${escapeHtml(item.created_by_name || "임직원")}</td>
      <td>${formatPlaudDate(item.created_at)}</td>
      <td><button class="plaud-row-button" data-plaud-detail="${escapeHtml(item.id)}">상세 보기</button></td>
    </tr>`;
  }).join("");
  document.querySelectorAll('[data-plaud-detail]').forEach((button) => button.addEventListener("click", () => openPlaudMeetingDetail(button.dataset.plaudDetail)));
};

const renderPlaudStats = (stats = {}) => {
  const values = {
    total: stats.total || 0,
    completed: stats.completed || 0,
    processing: stats.processing || 0,
    failed: stats.failed || 0,
  };
  Object.entries(values).forEach(([key, value]) => {
    const host = $(`[data-plaud-stat="${key}"]`);
    if (host) host.textContent = Number(value).toLocaleString("ko-KR");
  });
};

const refreshPlaudPage = async ({ sync = false } = {}) => {
  if (plaudPageLoading || currentPage !== "meetings_plaud") return;
  plaudPageLoading = true;
  try {
    if (sync && plaudConfig?.configured) await plaudRequest("/api/meetings/plaud/sync", { method: "POST" });
    const params = new URLSearchParams({ page: "1", page_size: "30" });
    if (plaudStatusFilter) params.set("status", plaudStatusFilter);
    if (plaudSearchQuery) params.set("query", plaudSearchQuery);
    const [stats, list] = await Promise.all([
      plaudRequest("/api/meetings/plaud/stats"),
      plaudRequest(`/api/meetings/plaud?${params}`),
    ]);
    if (currentPage !== "meetings_plaud") return;
    renderPlaudStats(stats);
    renderPlaudRows(list.items || [], list.total || 0);
  } catch (error) {
    const body = $("#plaudMeetingRows");
    if (body) body.innerHTML = `<tr><td colspan="6"><div class="plaud-empty error"><i>!</i><b>회의록을 불러오지 못했습니다.</b><span>${escapeHtml(error.message)}</span></div></td></tr>`;
  } finally {
    plaudPageLoading = false;
  }
};

const openPlaudMeetingDetail = async (meetingId) => {
  const dialog = $("#plaudMeetingDialog");
  const body = $("#plaudMeetingDetailBody");
  if (!dialog || !body) return;
  body.innerHTML = '<div class="plaud-detail-loading"><span class="spinner"></span><p>회의록을 불러오는 중입니다.</p></div>';
  dialog.showModal();
  try {
    const result = await plaudRequest(`/api/meetings/plaud/${encodeURIComponent(meetingId)}`);
    const meeting = result.meeting || {};
    const status = plaudStatusMeta(meeting.status);
    const title = meeting.title || meeting.masked_title || "회의록";
    let content = "";
    if (meeting.status === "completed" && meeting.segments?.length) {
      content = `<div class="plaud-transcript-list">${meeting.segments.map((segment) => `<article><header><b>${escapeHtml(segment.speaker_id || segment.speaker || "화자")}</b><span>${formatPlaudDuration(segment.start || 0)}</span></header><p>${escapeHtml(segment.text || "")}</p></article>`).join("")}</div>`;
    } else if (meeting.status === "completed") {
      content = `<div class="plaud-transcript-text">${escapeHtml(meeting.transcript || "전사 내용이 없습니다.").replace(/\n/g, "<br>")}</div>`;
    } else if (meeting.status === "failed") {
      content = `<div class="plaud-detail-state failed"><i>!</i><b>회의록 생성에 실패했습니다.</b><p>${escapeHtml(meeting.error_message || "관리자에게 문의해 주세요.")}</p></div>`;
    } else {
      content = '<div class="plaud-detail-state"><span class="spinner"></span><b>PLAUD가 녹음 내용을 처리하고 있습니다.</b><p>완료되면 회의록 내용이 자동으로 표시됩니다.</p></div>';
    }
    body.innerHTML = `<header class="plaud-detail-heading"><div><span class="eyebrow">PLAUD MEETING MINUTES</span><h2>${escapeHtml(title)}</h2><p>${meeting.can_view_title ? "작성자 또는 관리자 권한으로 원문 제목을 표시합니다." : "제목 마스킹이 적용되었습니다."}</p></div><span class="plaud-status ${status.className}"><i></i>${status.label}</span></header>
      <div class="plaud-detail-meta"><span><b>등록자</b>${escapeHtml(meeting.created_by_name || "임직원")}</span><span><b>등록일</b>${formatPlaudDate(meeting.created_at)}</span><span><b>길이</b>${formatPlaudDuration(meeting.duration_seconds)}</span><span><b>언어</b>${escapeHtml(meeting.language || "자동 감지")}</span></div>
      <section class="plaud-detail-content"><h3>전사 회의록</h3>${content}</section>`;
  } catch (error) {
    body.innerHTML = `<div class="plaud-detail-state failed"><i>!</i><b>회의록을 불러오지 못했습니다.</b><p>${escapeHtml(error.message)}</p></div>`;
  }
};

const uploadPlaudMeeting = async () => {
  const file = plaudSelectedFile;
  const submit = $("#plaudUploadButton");
  const title = $("#plaudTitleInput")?.value.trim() || "";
  if (!file) return showToast("녹음파일을 선택해 주세요.");
  if (!plaudConfig?.configured) return showToast("PLAUD 인증정보 등록 후 업로드할 수 있습니다.");
  const fileType = file.name.split(".").pop().toLowerCase();
  submit.disabled = true;
  try {
    updatePlaudProgress(2, "PLAUD 업로드를 준비하고 있습니다.");
    const upload = await plaudRequest("/api/meetings/plaud/uploads/start", {
      method: "POST",
      body: JSON.stringify({ filename: file.name, file_size: file.size, file_type: fileType }),
    });
    const partList = [];
    for (let index = 0; index < upload.parts.length; index += 1) {
      const part = upload.parts[index];
      const offset = (Number(part.part_number) - 1) * Number(upload.chunk_size);
      const chunk = file.slice(offset, Math.min(file.size, offset + Number(upload.chunk_size)));
      const response = await fetch(part.upload_url, { method: "PUT", body: chunk });
      if (!response.ok) throw new Error(`파일 ${part.part_number}번 조각 업로드에 실패했습니다.`);
      const etag = response.headers.get("ETag") || response.headers.get("etag");
      if (!etag) throw new Error("PLAUD 업로드 확인값을 받지 못했습니다. 브라우저 CORS 설정을 확인해 주세요.");
      partList.push({ PartNumber: Number(part.part_number), ETag: etag });
      updatePlaudProgress(5 + ((index + 1) / upload.parts.length) * 82, `녹음파일 업로드 중 · ${index + 1}/${upload.parts.length}`);
    }
    updatePlaudProgress(92, "업로드를 완료하고 회의록 생성을 시작합니다.");
    await plaudRequest("/api/meetings/plaud/uploads/complete", {
      method: "POST",
      body: JSON.stringify({
        file_id: upload.file_id,
        upload_id: upload.upload_id,
        part_list: partList,
        filename: file.name,
        file_size: file.size,
        file_type: fileType,
        title,
      }),
    });
    updatePlaudProgress(100, "업로드가 완료되었습니다. PLAUD에서 회의록을 생성 중입니다.", "success");
    showToast("녹음파일이 등록되었습니다. 회의록 처리 상태를 자동으로 확인합니다.");
    $("#plaudTitleInput").value = "";
    $("#plaudFileInput").value = "";
    setPlaudFile(null);
    await refreshPlaudPage();
  } catch (error) {
    updatePlaudProgress(100, error.message || "업로드에 실패했습니다.", "failed");
    showToast(error.message || "PLAUD 업로드에 실패했습니다.");
  } finally {
    submit.disabled = !plaudSelectedFile || !plaudConfig?.configured;
  }
};

const bindPlaudPage = () => {
  const zone = $("#plaudDropZone");
  const input = $("#plaudFileInput");
  const choose = $("#plaudChooseFile");
  choose.addEventListener("click", () => input.click());
  input.addEventListener("change", () => setPlaudFile(input.files?.[0] || null));
  ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove("dragging"); }));
  zone.addEventListener("drop", (event) => setPlaudFile(event.dataTransfer?.files?.[0] || null));
  $("#plaudUploadButton").addEventListener("click", uploadPlaudMeeting);
  $("#plaudMeetingDialogClose").addEventListener("click", () => $("#plaudMeetingDialog").close());
  let searchTimer;
  $("#plaudSearch").addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { plaudSearchQuery = event.target.value.trim(); refreshPlaudPage(); }, 250);
  });
  document.querySelectorAll('[data-plaud-filter]').forEach((button) => button.addEventListener("click", () => {
    plaudStatusFilter = button.dataset.plaudFilter;
    document.querySelectorAll('[data-plaud-filter]').forEach((item) => item.classList.toggle("active", item === button));
    refreshPlaudPage();
  }));
};

const renderPlaudMeetingPage = async () => {
  plaudSelectedFile = null;
  plaudStatusFilter = "";
  plaudSearchQuery = "";
  pageContent.innerHTML = `
    <section class="page-heading plaud-page-heading"><div><span class="eyebrow">COLLABORATION · PLAUD</span><h1>회의록_Plaud</h1><p>녹음파일을 업로드하고 PLAUD 전사 처리 현황과 회의록을 한곳에서 관리합니다.</p></div><span id="plaudConnectionBadge" class="plaud-connection waiting"><i></i>PLAUD 연결 확인 중</span></section>
    <section class="plaud-stat-grid">
      <article><span>총 회의록</span><strong data-plaud-stat="total">0</strong><small>누적 등록 건수</small></article>
      <article><span>완료</span><strong data-plaud-stat="completed">0</strong><small>회의록 생성 완료</small></article>
      <article><span>처리 중</span><strong data-plaud-stat="processing">0</strong><small>PLAUD 분석 진행</small></article>
      <article><span>실패</span><strong data-plaud-stat="failed">0</strong><small>재확인 필요</small></article>
    </section>
    <section class="content-panel plaud-upload-panel">
      <header class="plaud-section-heading"><div><span class="eyebrow">NEW RECORDING</span><h2>녹음파일 업로드</h2><p>제목은 게시판에서 기본적으로 마스킹되며 작성자와 관리자만 상세 화면에서 원문을 확인할 수 있습니다.</p></div></header>
      <label class="plaud-title-field">회의 제목 <span>선택 입력</span><input id="plaudTitleInput" maxlength="200" placeholder="입력하지 않으면 파일명으로 생성됩니다." /></label>
      <div id="plaudDropZone" class="plaud-drop-zone">
        <input id="plaudFileInput" type="file" accept=".mp3,.opus,audio/mpeg,audio/ogg" hidden />
        <div class="plaud-upload-icon">＋</div>
        <div id="plaudFileSummary"><b>녹음파일을 여기에 놓아주세요.</b><span>또는 아래 버튼에서 파일을 선택하세요 · MP3/OPUS · 최대 2GB</span></div>
        <button id="plaudChooseFile" type="button" class="button secondary">녹음파일 선택</button>
      </div>
      <div id="plaudUploadProgress" class="plaud-upload-progress" hidden></div>
      <footer class="plaud-upload-actions"><span>파일은 앱 서버에 저장하지 않고 PLAUD로 분할 전송됩니다.</span><button id="plaudUploadButton" type="button" class="button primary" disabled>PLAUD 회의록 만들기</button></footer>
    </section>
    <section class="content-panel plaud-board-panel">
      <header class="plaud-board-header"><div><span class="eyebrow">MEETING BOARD</span><h2>회의록 게시판 <small id="plaudBoardCount">0건</small></h2></div><div class="plaud-board-tools"><input id="plaudSearch" placeholder="회의 제목 검색" /><div class="plaud-filter-buttons"><button class="active" data-plaud-filter="">전체</button><button data-plaud-filter="completed">완료</button><button data-plaud-filter="processing">처리 중</button><button data-plaud-filter="failed">실패</button></div></div></header>
      <div class="plaud-table-wrap"><table class="data-table plaud-table"><thead><tr><th>제목</th><th>상태</th><th>녹음 길이</th><th>등록자</th><th>등록일</th><th></th></tr></thead><tbody id="plaudMeetingRows"><tr><td colspan="6"><div class="plaud-empty"><span class="spinner"></span><b>회의록을 불러오는 중입니다.</b></div></td></tr></tbody></table></div>
    </section>
    <dialog id="plaudMeetingDialog" class="plaud-meeting-dialog"><button id="plaudMeetingDialogClose" class="plaud-dialog-close" aria-label="닫기">×</button><div id="plaudMeetingDetailBody"></div></dialog>`;
  bindPlaudPage();
  try {
    plaudConfig = await plaudRequest("/api/meetings/plaud/config");
    if (currentPage !== "meetings_plaud") return;
    const badge = $("#plaudConnectionBadge");
    badge.className = `plaud-connection ${plaudConfig.configured ? "ready" : "waiting"}`;
    badge.innerHTML = `<i></i>${plaudConfig.configured ? "PLAUD 연결 준비됨" : "PLAUD 연결 대기"}`;
    $("#plaudFileInput").disabled = !plaudConfig.configured;
    $("#plaudChooseFile").disabled = !plaudConfig.configured;
  } catch (error) {
    showToast(error.message || "PLAUD 연결 상태를 확인하지 못했습니다.");
  }
  await refreshPlaudPage({ sync: Boolean(plaudConfig?.configured) });
  plaudPollTimer = setInterval(() => refreshPlaudPage({ sync: true }), 15000);
};


const builtInEditableMenuIds = new Set([
  "group_workspace", "group_business", "group_collaboration",
  "management", "management_ar", "management_hr", "management_routine",
  "marketing", "marketing_allo", "marketing_dental", "marketing_medical", "marketing_aesthetic", "marketing_global",
  "technology", "technology_focus", "amarans", "meetings", "meetings_openai", "meetings_plaud", "calendar", "tf", "tf_ar"
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
  clearInterval(plaudPollTimer);
  plaudPollTimer = null;
  appView.hidden = true;
  guestView.hidden = false;
  loginForm.reset();
  showToast("안전하게 로그아웃되었습니다.");
});

const renderNavigation = () => {
  $("#mainNav").innerHTML = menuGroups.filter((group) => group.id !== "admin" || currentUser?.role === "admin").map((group) => `
    <section class="nav-section">
      <div class="nav-heading">${group.label}</div>
      ${group.items.map((item) => {
        const hasChildren = Boolean(item.children?.length);
        if (item.url && !hasChildren) return `<a class="nav-item" href="${escapeHtml(item.url)}"${linkAttributes(item.url)}><span class="nav-icon">${escapeHtml(item.icon || "◇")}</span><span>${escapeHtml(item.title)}</span><span class="chevron">${linkIndicator(item.url)}</span></a>`;
        return `
        <button class="nav-item ${item.id === currentPage || item.children?.some((child) => child.id === currentPage) ? "active expanded" : ""}" data-nav="${escapeHtml(item.id)}" data-has-children="${hasChildren}">
          <span class="nav-icon">${escapeHtml(item.icon || "◇")}</span><span>${escapeHtml(item.title)}</span>${hasChildren ? '<span class="chevron">›</span>' : ""}
        </button>
        ${hasChildren ? `<div class="submenu ${item.children?.some((child) => child.id === currentPage) ? "open" : ""}" data-submenu="${escapeHtml(item.id)}"><div>${item.children.map((child) => child.url
          ? `<a data-external="${escapeHtml(child.title)}" data-url="${escapeHtml(child.url)}" href="${escapeHtml(child.url)}"${linkAttributes(child.url)}>${escapeHtml(child.title)}<span style="float:right">${linkIndicator(child.url)}</span></a>`
          : `<button data-sub-page="${escapeHtml(child.id)}">${escapeHtml(child.title)}<span style="float:right">→</span></button>`).join("")}</div></div>` : ""}
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
  document.querySelectorAll("[data-sub-page]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.subPage)));
};

const navigate = (page) => {
  if (["admin", "admin_calendar"].includes(page) && currentUser?.role !== "admin") {
    page = "dashboard";
    showToast("관리자 전용 메뉴입니다.");
  }
  currentPage = page;
  clearInterval(carouselTimer);
  clearInterval(plaudPollTimer);
  plaudPollTimer = null;
  pageContent.classList.toggle("dashboard-page", page === "dashboard");
  pageContent.classList.toggle("calendar-page", ["calendar", "admin_calendar"].includes(page));
  renderNavigation();
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.nav === page));
  const title = menuGroups.flatMap((group) => group.items.flatMap((item) => [item, ...(item.children || [])])).find((item) => item.id === page)?.title || "통합 대시보드";
  $("#breadcrumbText").textContent = title;
  if (page === "dashboard") renderDashboard();
  else if (page === "admin") renderAdmin();
  else if (page === "admin_calendar") renderCalendarSettings();
  else if (page === "calendar") renderCalendarPage();
  else if (page === "meetings_plaud") renderPlaudMeetingPage();
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

const clearCalendarEventCache = () => {
  calendarEventCache.clear();
  calendarEventRequests.clear();
};

const loadCalendarEvents = async (monthKey) => {
  const cached = calendarEventCache.get(monthKey);
  if (cached && Date.now() - cached.savedAt < CALENDAR_EVENT_CACHE_MS) return cached.result;
  if (calendarEventRequests.has(monthKey)) return calendarEventRequests.get(monthKey);
  const request = fetch("/api/calendar/events?month=" + encodeURIComponent(monthKey), { headers: { accept: "application/json" } })
    .then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      calendarEventCache.set(monthKey, { savedAt: Date.now(), result });
      return result;
    })
    .finally(() => calendarEventRequests.delete(monthKey));
  calendarEventRequests.set(monthKey, request);
  return request;
};

const renderCalendarView = async () => {
  const body = $("#carouselBody");
  if (!body || carouselMode !== "calendar") return;
  const requestId = ++calendarRenderRequestId;
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth() + 1;
  const monthKey = `${year}-${String(month).padStart(2,"0")}`;
  body.innerHTML = `<div class="calendar-loading"><span class="spinner"></span><p>Google Calendar 일정을 불러오는 중입니다.</p></div>`;
  try {
    const result = await loadCalendarEvents(monthKey);
    if (requestId !== calendarRenderRequestId || carouselMode !== "calendar" || !body.isConnected) return;
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
    if (requestId !== calendarRenderRequestId || carouselMode !== "calendar" || !body.isConnected) return;
    body.innerHTML = `<div class="calendar-error-state"><i>!</i><h3>일정을 불러오지 못했습니다.</h3><p>${escapeHtml(error.message || "잠시 후 다시 시도하거나 관리자에게 문의해 주세요.")}</p></div>`;
  }
};

const alloRegionDetails = [
  { id: "all", name: "전국", secured: 122, total: 780, coverage: 16 },
  { id: "seoul", name: "서울", secured: 22, total: 150, coverage: 15, x: 42.7, y: 23.3 },
  { id: "incheon", name: "인천", secured: 3, total: 44, coverage: 7, x: 40.7, y: 24.2 },
  { id: "gyeonggi", name: "경기", secured: 16, total: 170, coverage: 9, x: 44.2, y: 27.4 },
  { id: "gangwon", name: "강원", secured: 0, total: 20, coverage: 0, x: 53.9, y: 18.4 },
  { id: "chungbuk", name: "충북", secured: 3, total: 22, coverage: 14, x: 50.8, y: 37.6 },
  { id: "chungnam", name: "충남", secured: 1, total: 26, coverage: 4, x: 42.2, y: 40.2 },
  { id: "daejeon", name: "대전", secured: 6, total: 20, coverage: 30, x: 47.3, y: 43.5 },
  { id: "sejong", name: "세종시", secured: 0, total: 1, coverage: 0, x: 46.1, y: 37.6 },
  { id: "gyeongbuk", name: "경북", secured: 15, total: 29, coverage: 52, x: 58.2, y: 42.5 },
  { id: "daegu", name: "대구", secured: 37, total: 57, coverage: 65, x: 57.1, y: 50.4 },
  { id: "jeonbuk", name: "전북", secured: 0, total: 28, coverage: 0, x: 43.8, y: 52.9 },
  { id: "gyeongnam", name: "경남", secured: 2, total: 62, coverage: 3, x: 53.2, y: 58.1 },
  { id: "ulsan", name: "울산", secured: 7, total: 13, coverage: 54, x: 61.8, y: 55.5 },
  { id: "busan", name: "부산", secured: 10, total: 65, coverage: 15, x: 61.4, y: 62.5 },
  { id: "gwangju", name: "광주", secured: 0, total: 35, coverage: 0, x: 43, y: 64.4 },
  { id: "jeonnam", name: "전남", secured: 0, total: 31, coverage: 0, x: 40.7, y: 68.9 },
  { id: "jeju", name: "제주", secured: 0, total: 7, coverage: 0, x: 39.5, y: 90.7 }
];

const globalCountryDetails = [
  { id: "sa", name: "사우디아라비아", english: "Saudi Arabia", region: "중동", partners: 6, status: "영업 추진", fcst: "₩0", erp: "₩0", followUp: "1건", x: 62.5, y: 41.8 },
  { id: "us", name: "미국", english: "United States", region: "북미", partners: 3, status: "영업 추진", fcst: "원본 조회", erp: "원본 조회", followUp: "-", x: 23.1, y: 33.3 },
  { id: "de", name: "독일", english: "Germany", region: "유럽", partners: 5, status: "거래처 등록", fcst: "원본 조회", erp: "원본 조회", followUp: "-", x: 53.6, y: 23.4 },
  { id: "gb", name: "영국", english: "United Kingdom", region: "유럽", partners: 1, status: "거래처 등록", fcst: "원본 조회", erp: "원본 조회", followUp: "-", x: 50.2, y: 19.2 },
  { id: "cn", name: "중국", english: "China", region: "아시아", partners: 0, status: "영업 추진", fcst: "원본 조회", erp: "원본 조회", followUp: "-", x: 79.1, y: 33.3 },
  { id: "in", name: "인도", english: "India", region: "아시아", partners: 2, status: "영업 추진", fcst: "원본 조회", erp: "원본 조회", followUp: "-", x: 72.8, y: 48.9 },
  { id: "jp", name: "일본", english: "Japan", region: "아시아", partners: 0, status: "거래처 등록", fcst: "원본 조회", erp: "원본 조회", followUp: "-", x: 87.5, y: 34 },
  { id: "au", name: "호주", english: "Australia", region: "오세아니아", partners: 1, status: "거래처 등록", fcst: "원본 조회", erp: "원본 조회", followUp: "-", x: 87, y: 74.6 },
  { id: "br", name: "브라질", english: "Brazil", region: "남미", partners: 1, status: "거래처 등록", fcst: "원본 조회", erp: "원본 조회", followUp: "-", x: 29.5, y: 63.7 }
];

const alloMapDetailMarkup = (region) => {
  const uncovered = Math.max(region.total - region.secured, 0);
  return `<div class="map-detail-heading"><span>REGIONAL COVERAGE</span><h3>${region.name}</h3><small>확보 ${region.secured} / 전체 시장 ${region.total}</small></div>
    <div class="map-detail-score"><strong>${region.coverage}%</strong><span>지역 커버리지</span><i><em style="width:${region.coverage}%"></em></i></div>
    <div class="map-detail-metrics"><div><span>확보 타깃</span><b>${region.secured}</b></div><div><span>미확보</span><b>${uncovered}</b></div><div><span>전체 시장</span><b>${region.total}</b></div><div><span>커버리지</span><b>${region.coverage}%</b></div></div>
    <p class="map-detail-note">지도 또는 아래 지역을 선택하면 해당 지역의 요약 정보가 표시됩니다. 병원별 상세 내용은 원본 시스템에서 확인할 수 있습니다.</p>`;
};

const globalMapDetailMarkup = (country) => `<div class="map-detail-heading global"><span>${country.region}</span><h3>${country.name}</h3><small>${country.english} · ${country.status}</small></div>
  <div class="map-detail-metrics global"><div><span>거래처</span><b>${country.partners}</b></div><div><span>진행 상태</span><b>${country.status}</b></div><div><span>전체 FCST</span><b>${country.fcst}</b></div><div><span>ERP 확정</span><b>${country.erp}</b></div></div>
  <div class="map-detail-followup"><span>미결·후속조치</span><b>${country.followUp}</b></div>
  <p class="map-detail-note">국가 마커 또는 아래 국가를 선택하면 요약 정보가 변경됩니다. 거래처·매출 상세는 원본 시스템에서 확인할 수 있습니다.</p>`;

const selectAlloRegion = (id) => {
  const region = alloRegionDetails.find((item) => item.id === id) || alloRegionDetails[0];
  const target = $("#sourceMapSelectedDetail");
  if (target) target.innerHTML = alloMapDetailMarkup(region);
  $$('[data-allo-region]').forEach((button) => button.classList.toggle("active", button.dataset.alloRegion === region.id));
};

const selectGlobalCountry = (id) => {
  const country = globalCountryDetails.find((item) => item.id === id) || globalCountryDetails[0];
  const target = $("#sourceMapSelectedDetail");
  if (target) target.innerHTML = globalMapDetailMarkup(country);
  $$('[data-global-country]').forEach((button) => button.classList.toggle("active", button.dataset.globalCountry === country.id));
};

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
    <section class="source-map-panel allo-source-panel">
      <div class="source-map-body">
        <div class="source-map-stage">
          <figure class="source-map-crop allo-source-crop">
            <img src="./assets/medpark-allo-coverage.png" alt="MedPark-Allo 원본 전국 지역별 커버리지 지도" draggable="false" />
            ${alloRegionDetails.filter((region) => region.x).map((region) => `<button class="map-hotspot allo-hotspot" style="--x:${region.x}%;--y:${region.y}%" data-allo-region="${region.id}" aria-label="${region.name} 커버리지 상세 보기" data-label="${region.name}"></button>`).join("")}
          </figure>
        </div>
        <aside class="source-map-detail-panel">
          <div id="sourceMapSelectedDetail"></div>
          <div class="map-detail-selector allo-selector">${alloRegionDetails.map((region) => `<button data-allo-region="${region.id}"><span>${region.name}</span><b>${region.secured} / ${region.total}</b><small>${region.coverage}%</small></button>`).join("")}</div>
        </aside>
      </div>
      <footer class="source-map-footer"><span><i></i>관리자 로그인 후 확인한 원본 지도 화면</span><a href="https://medprk-medpark-allo.mycafe24.ai/" target="_blank" rel="noopener noreferrer">MedPark-Allo 열기 ↗</a></footer>
    </section>`;
  else body.innerHTML = `
    <section class="source-map-panel global-source-panel">
      <div class="source-map-body">
        <div class="source-map-stage">
          <figure class="source-map-crop global-source-crop">
            <img src="./assets/global-market-action-map.png" alt="Global-MAPS 원본 국가별 거래처 FCST ERP 확정매출 지도" draggable="false" />
            ${globalCountryDetails.map((country) => `<button class="map-hotspot global-hotspot" style="--x:${country.x}%;--y:${country.y}%" data-global-country="${country.id}" aria-label="${country.name} 거래처와 매출 상세 보기" data-label="${country.name}">${country.partners}</button>`).join("")}
          </figure>
        </div>
        <aside class="source-map-detail-panel global-detail-panel">
          <div id="sourceMapSelectedDetail"></div>
          <div class="map-detail-selector global-selector">${globalCountryDetails.map((country) => `<button data-global-country="${country.id}"><span>${country.name}</span><b>${country.partners}개 거래처</b></button>`).join("")}</div>
        </aside>
      </div>
      <footer class="source-map-footer"><span><i></i>관리자 로그인 후 확인한 원본 지도 화면</span><a href="https://medprk-medpark-global-maps.mycafe24.ai/" target="_blank" rel="noopener noreferrer">Global-MAPS 열기 ↗</a></footer>
    </section>`;
  if (carouselMode === "allo") {
    $$('[data-allo-region]').forEach((button) => button.addEventListener("click", () => selectAlloRegion(button.dataset.alloRegion)));
    selectAlloRegion("all");
  }
  if (carouselMode === "global") {
    $$('[data-global-country]').forEach((button) => button.addEventListener("click", () => selectGlobalCountry(button.dataset.globalCountry)));
    selectGlobalCountry("sa");
  }
  $("#carouselProgress").innerHTML = "<i></i>";
  $$('[data-carousel]').forEach((button) => button.onclick = () => { carouselMode = button.dataset.carousel; renderCarousel(); startCarousel(); });
};

const startCarousel = () => {
  clearInterval(carouselTimer);
  carouselTimer = null;
  if (carouselPaused || currentPage !== "dashboard") return;
  const progress = $("#carouselProgress");
  if (progress) progress.innerHTML = "<i></i>";
  carouselTimer = setInterval(() => {
    carouselMode = carouselModes[(carouselModes.indexOf(carouselMode) + 1) % carouselModes.length];
    renderCarousel();
  }, 30000);
};

const setCarouselPaused = (paused) => {
  if (currentPage !== "dashboard") return;
  carouselPaused = paused;
  const panel = $(".main-carousel-panel");
  panel?.classList.toggle("carousel-paused", paused);
  if (paused) {
    clearInterval(carouselTimer);
    carouselTimer = null;
  } else startCarousel();
};

const bindCarouselPause = () => {
  const panel = $(".main-carousel-panel");
  if (!panel) return;
  panel.addEventListener("mouseenter", () => setCarouselPaused(true));
  panel.addEventListener("mouseleave", () => setCarouselPaused(false));
};

const renderQuickLinks = () => {
  const list = $("#quickLinksList");
  if (!list) return;
  list.innerHTML = quickLinks.map((link) => `<a class="quick-link-compact" href="${escapeHtml(link.url)}"${linkAttributes(link.url)}><i>${escapeHtml(link.icon)}</i><span>${escapeHtml(link.label)}</span><b>${linkIndicator(link.url)}</b></a>`).join("") || '<p class="quick-empty">선택한 시스템이 없습니다.</p>';
};

const openQuickLinksEditor = () => {
  const selected = new Set(quickLinks.map((link) => link.id));
  $("#quickLinksOptions").innerHTML = quickLinkCatalog.map((link) => `<label><input type="checkbox" name="system_id" value="${escapeHtml(link.id)}" ${selected.has(link.id) ? "checked" : ""} /><i>${escapeHtml(link.icon)}</i><span><b>${escapeHtml(link.label)}</b><small>${escapeHtml(linkLocation(link.url))}</small></span></label>`).join("");
  $("#quickLinksError").textContent = "";
  quickLinksDialog.showModal();
};

const renderDashboard = () => {
  resetCalendarToToday();
  carouselMode = "calendar";
  carouselPaused = false;
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
  bindCarouselPause();
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
    <td><span class="tag">${user.role === "admin" ? "관리자" : "기본(임직원)"}</span></td><td><span class="tag ${user.status !== "active" ? "gray" : ""}">${user.status === "active" ? "활성" : "비활성"}</span></td>
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
      clearCalendarEventCache();
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
        clearCalendarEventCache();
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
      ? `<a class="search-result" href="${escapeHtml(item.url)}"${linkAttributes(item.url)}><b>${escapeHtml(item.icon)} &nbsp; ${escapeHtml(item.title)}</b><span>${escapeHtml(item.group)} · ${isInternalUrl(item.url) ? "내부 이동" : "새 탭"}</span></a>`
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
  const bootstrapData = Promise.allSettled([loadMenuConfig(), loadQuickLinks()]);
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
  await bootstrapData;
  if (!currentUser || appView.hidden) return;
  renderNavigation();
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.nav === currentPage));
  if (currentPage === "dashboard") renderQuickLinks();
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
