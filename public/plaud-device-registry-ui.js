(() => {
  if (window.__MEDPARK_PLAUD_EASY_REGISTRY_UI__) return;
  window.__MEDPARK_PLAUD_EASY_REGISTRY_UI__ = true;

  const PANEL_ID = "plaudDeviceDirectRegistry";
  const STYLE_ID = "plaudEasyRegistryStyle";
  let plaudState = { items: [], users: [], plaud_configured: false, can_manage: false };
  let androidState = { items: [], users: [], can_manage: false };
  let latestAndroidCode = null;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[ch]));

  function normalizeList(raw) {
    return {
      items: Array.isArray(raw?.items) ? raw.items : [],
      users: Array.isArray(raw?.users) ? raw.users : [],
      can_manage: raw?.can_manage === true,
      plaud_configured: raw?.plaud_configured === true,
    };
  }

  async function api(url, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const response = await fetch(url, { ...options, headers, credentials: "same-origin", cache: "no-store" });
    const type = response.headers.get("content-type") || "";
    const text = await response.text();
    let data = null;
    if (type.includes("application/json")) {
      try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
    }
    if (!response.ok) {
      throw new Error(data?.message || `요청에 실패했습니다. (HTTP ${response.status})`);
    }
    if (!data || typeof data !== "object") {
      throw new Error("기기 등록 API가 아직 연결되지 않았습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.");
    }
    return data;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .per-panel{margin:0 0 18px;padding:20px;border:1px solid #c5ddd5;border-radius:17px;background:linear-gradient(135deg,#fff,#f4faf7);box-shadow:0 12px 30px rgba(7,84,72,.07)}
      .per-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:15px}.per-title{display:flex;align-items:center;gap:12px}.per-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:#087563;color:#fff;font-size:21px;box-shadow:0 8px 20px rgba(8,117,99,.18)}.per-kicker{display:block;color:#087563;font-size:8px;font-weight:900;letter-spacing:1.2px}.per-head h3{margin:4px 0;color:#153f35;font-size:17px}.per-head p{margin:0;color:#74857f;font-size:8px;line-height:1.6}.per-badge{padding:7px 10px;border:1px solid #d7e6e1;border-radius:9px;background:#fff;color:#587069;font-size:8px;font-weight:850}
      .per-process{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:0 0 14px}.per-step{padding:10px;border:1px solid #dce9e4;border-radius:11px;background:#fff}.per-step b{display:grid;place-items:center;width:24px;height:24px;margin-bottom:6px;border-radius:7px;background:#e7f5ef;color:#08735f;font-size:8px}.per-step strong{display:block;color:#34554c;font-size:8px}.per-step span{display:block;margin-top:3px;color:#87938f;font-size:7px;line-height:1.45}
      .per-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.per-card{padding:15px;border:1px solid #dce9e4;border-radius:13px;background:#fff}.per-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:11px}.per-card-head h4{margin:0;color:#23483e;font-size:12px}.per-card-head p{margin:4px 0 0;color:#7b8985;font-size:8px;line-height:1.5}.per-num{display:grid;place-items:center;min-width:28px;height:28px;border-radius:8px;background:#e9f6f1;color:#087563;font-size:9px;font-weight:900}
      .per-guide{display:grid;gap:6px;margin:9px 0 11px}.per-guide-row{display:flex;gap:8px;align-items:flex-start;padding:8px;border-radius:9px;background:#f7faf9}.per-guide-row b{display:grid;place-items:center;flex:none;width:20px;height:20px;border-radius:6px;background:#e4f3ed;color:#087563;font-size:7px}.per-guide-row span{color:#5e706a;font-size:8px;line-height:1.55}.per-guide-row strong{color:#2c4e45}
      .per-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}.per-fields label{display:grid;gap:5px;color:#52645e;font-size:8px;font-weight:800}.per-fields input,.per-fields select{width:100%;height:38px;padding:0 10px;border:1px solid #d5e2de;border-radius:8px;background:#fff;color:#30443e;font-size:9px;outline:none}.per-fields input:focus,.per-fields select:focus{border-color:#0a9b7e;box-shadow:0 0 0 3px rgba(10,155,126,.1)}.per-fields small{color:#8a9793;font-size:7px;font-weight:500}.per-span2{grid-column:1/-1}.per-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:10px}.per-btn{height:34px;padding:0 12px;border:1px solid #d5e2de;border-radius:8px;background:#fff;color:#586a64;font-size:8px;font-weight:850;cursor:pointer}.per-btn.primary{border-color:#087563;background:#087563;color:#fff}.per-btn.secondary{border-color:#abd6ca;background:#edf8f4;color:#08715e}.per-btn.danger{border-color:#eccdca;background:#fff7f5;color:#a24e48}.per-btn:disabled{opacity:.45;cursor:not-allowed}
      .per-message{display:none;margin-top:9px;padding:9px 10px;border-radius:8px;background:#eef7f4;color:#37675b;font-size:8px;line-height:1.55}.per-message.show{display:block}.per-message.error{background:#fff1ef;color:#9f4f47}.per-message.warn{background:#fff8e8;color:#816225}
      .per-code-box{display:none;margin-top:10px;padding:13px;border:1px solid #b8dbcf;border-radius:11px;background:#f3fbf8}.per-code-box.show{display:block}.per-code-label{color:#658078;font-size:8px}.per-code{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:5px}.per-code b{font:900 20px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:#075f51;letter-spacing:1.5px}.per-code small{display:block;margin-top:6px;color:#7e8f89;font-size:7px}
      .per-advanced{margin-top:8px}.per-advanced summary{cursor:pointer;color:#667a73;font-size:8px;font-weight:800}.per-advanced .per-fields{margin-top:8px}
      .per-progress{display:none;margin-top:10px;padding:10px;border-radius:10px;background:#f7faf9}.per-progress.show{display:grid;gap:6px}.per-progress-row{display:flex;align-items:center;gap:7px;color:#60726c;font-size:8px}.per-progress-row i{width:8px;height:8px;border-radius:50%;background:#c8d1ce}.per-progress-row.ok i{background:#12a57a}.per-progress-row.wait i{background:#d6a631}.per-progress-row.fail i{background:#d75e54}.per-progress-row b{color:#314f47}
      .per-table-wrap{margin-top:12px;overflow-x:auto;border:1px solid #dce8e4;border-radius:11px;background:#fff}.per-table{width:100%;min-width:920px;border-collapse:collapse}.per-table th{padding:8px 9px;background:#f3f8f6;border-bottom:1px solid #dce8e4;color:#71827d;font-size:7px;text-align:left;white-space:nowrap}.per-table td{padding:10px 9px;border-bottom:1px solid #edf2f0;color:#566761;font-size:8px;white-space:nowrap}.per-empty{text-align:center!important;padding:18px!important;color:#87938f!important}.per-status{display:inline-flex;padding:4px 6px;border-radius:6px;background:#fff4d9;color:#85631d;font-size:7px;font-weight:850}.per-status.ok{background:#e8f7f1;color:#08745e}.per-status.fail{background:#fff0ee;color:#a14d46}.per-row-actions{display:flex;gap:4px;flex-wrap:wrap}
      @media(max-width:1050px){.per-grid{grid-template-columns:1fr}.per-process{grid-template-columns:repeat(3,1fr)}}@media(max-width:650px){.per-head{flex-direction:column}.per-process,.per-fields{grid-template-columns:1fr}.per-span2{grid-column:auto}.per-code{align-items:flex-start;flex-direction:column}.per-code b{font-size:16px}}
    `;
    document.head.appendChild(style);
  }

  function isPlaudPage() {
    const root = document.getElementById("pageContent");
    const title = root?.querySelector(".plaud-page-heading h1, .page-heading h1");
    return Boolean(title && /회의록[_\s-]*Plaud/i.test(title.textContent || ""));
  }

  function ensurePanel() {
    if (!isPlaudPage()) return null;
    const root = document.getElementById("pageContent");
    if (!root) return null;
    let panel = root.querySelector(`#${PANEL_ID}`);
    if (panel) return panel;
    const heading = root.querySelector(".plaud-page-heading, .page-heading");
    if (!heading) return null;
    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "per-panel";
    panel.innerHTML = `
      <div class="per-head">
        <div class="per-title"><div class="per-icon">⌁</div><div><span class="per-kicker">DEVICE REGISTRATION · EASY MODE</span><h3>PLAUD 사용 준비</h3><p>Android 단말을 먼저 등록한 뒤 PLAUD 기기를 등록·연결합니다. 어려운 식별값은 대부분 자동 처리합니다.</p></div></div>
        <div class="per-badge" id="perSummary">연결 준비</div>
      </div>

      <div class="per-process">
        <div class="per-step"><b>01</b><strong>Android 등록코드 발급</strong><span>사용할 임직원을 선택합니다.</span></div>
        <div class="per-step"><b>02</b><strong>Android 앱에서 코드 입력</strong><span>단말 정보가 자동 등록됩니다.</span></div>
        <div class="per-step"><b>03</b><strong>PLAUD 모델·SN 입력</strong><span>기본정보만 입력합니다.</span></div>
        <div class="per-step"><b>04</b><strong>PLAUD Cloud Bind</strong><span>웹에서 자동으로 이어서 처리합니다.</span></div>
        <div class="per-step"><b>05</b><strong>Android BLE 연결</strong><span>앱에서 최종 기기 페어링을 완료합니다.</span></div>
      </div>

      <div class="per-grid">
        <section class="per-card" id="perAndroidCard">
          <div class="per-card-head"><div><h4>1. Android 단말 등록</h4><p>Android 앱을 사용할 임직원을 지정하고 30분 유효 등록코드를 발급합니다.</p></div><span class="per-num">01</span></div>
          <div class="per-guide">
            <div class="per-guide-row"><b>1</b><span>아래에서 <strong>Android 단말을 사용할 임직원</strong>을 선택합니다.</span></div>
            <div class="per-guide-row"><b>2</b><span><strong>등록코드 발급</strong>을 누르면 12자리 코드가 생성됩니다.</span></div>
            <div class="per-guide-row"><b>3</b><span>Android의 <strong>MedPark 앱 → PLAUD 연결 → 회사 등록코드</strong>에 코드를 입력합니다.</span></div>
            <div class="per-guide-row"><b>4</b><span>앱이 단말 모델·Android 버전·앱 설치 ID를 서버에 보내면 <strong>등록 완료</strong>로 바뀝니다.</span></div>
          </div>
          <div class="per-fields">
            <label>사용자<select id="perAndroidUser"><option value="">임직원 선택<[REDACTED]></select><small>이 Android 단말을 사용할 임직원</small></label>
            <label>단말명<input id="perAndroidName" placeholder="예: 정호수 업무폰"><small>비우면 사용자명 + Android로 자동 생성</small></label>
          </div>
          <div class="per-actions"><button type="button" class="per-btn primary" id="perAndroidCreate">등록코드 발급</button></div>
          <div class="per-message" id="perAndroidMessage"></div>
          <div class="per-code-box" id="perAndroidCodeBox"><div class="per-code-label">Android 앱에 입력할 등록코드</div><div class="per-code"><b id="perAndroidCode">----</b><button type="button" class="per-btn secondary" id="perCopyAndroidCode">코드 복사</button></div><small>30분 동안 1회 사용할 수 있습니다. Android 앱에서 입력되면 해당 단말로 확정 등록됩니다.</small></div>
        </section>

        <section class="per-card" id="perPlaudCard">
          <div class="per-card-head"><div><h4>2. PLAUD 기기 등록 및 연결</h4><p>모델, Serial Number, 사용자만 선택하면 나머지는 자동 처리합니다.</p></div><span class="per-num">02</span></div>
          <div class="per-guide">
            <div class="per-guide-row"><b>1</b><span><strong>PLAUD 모델</strong>을 선택합니다. Note Pro 또는 NotePin.</span></div>
            <div class="per-guide-row"><b>2</b><span>기기 본체 또는 PLAUD 앱에서 <strong>Serial Number(SN)</strong>를 확인해 입력합니다.</span></div>
            <div class="per-guide-row"><b>3</b><span><strong>사용자</strong>를 선택하고 “기기 등록 및 연결”을 누릅니다.</span></div>
            <div class="per-guide-row"><b>4</b><span>MedPark 등록 → PLAUD Cloud Bind까지 자동 진행합니다. 이후 Android 앱에서 BLE 연결만 완료합니다.</span></div>
          </div>
          <div class="per-fields">
            <label>PLAUD 모델<select id="perPlaudModel"><option value="">모델 선택<[REDACTED]><option value="notepro">PLAUD Note Pro<[REDACTED]><option value="notepins">PLAUD NotePin<[REDACTED]></select><small>Device Type은 자동 결정</small></label>
            <label>Serial Number<input id="perPlaudSerial" placeholder="기기 SN"><small>기기 본체 또는 PLAUD 앱에서 확인</small></label>
            <label class="per-span2">사용자<select id="perPlaudUser"><option value="">임직원 선택<[REDACTED]></select><small>Partner User ID는 사용자 계정 기준 자동 생성</small></label>
          </div>
          <details class="per-advanced"><summary>고급설정 보기</summary><div class="per-fields"><label>기기명<input id="perPlaudName" placeholder="자동 생성"><small>예: PLAUD Note Pro · 123456</small></label><label>Partner User ID<input id="perPartnerUser" placeholder="자동 생성"><small>직접 수정이 필요한 경우에만 입력</small></label></div></details>
          <div class="per-actions"><button type="button" class="per-btn primary" id="perPlaudRegister">기기 등록 및 연결</button></div>
          <div class="per-message" id="perPlaudMessage"></div>
          <div class="per-progress" id="perPlaudProgress"><div class="per-progress-row" id="perStepRegistry"><i></i><b>1. MedPark Registry 등록</b><span>대기</span></div><div class="per-progress-row" id="perStepCloud"><i></i><b>2. PLAUD Cloud Bind</b><span>대기</span></div><div class="per-progress-row" id="perStepBle"><i></i><b>3. Android BLE Bind</b><span>대기</span></div></div>
        </section>
      </div>

      <div class="per-table-wrap"><table class="per-table"><thead><tr><th>구분</th><th>기기/단말</th><th>사용자</th><th>식별정보</th><th>상태</th><th>최종 연결</th><th>관리</th></tr></thead><tbody id="perDeviceBody"><tr><td colspan="7" class="per-empty">등록기기 정보를 불러오는 중입니다.</td></tr></tbody></table></div>
    `;
    heading.insertAdjacentElement("afterend", panel);
    return panel;
  }

  function combinedUsers() {
    const map = new Map();
    [...androidState.users, ...plaudState.users].forEach((u) => {
      if (u?.id) map.set(String(u.id), u);
    });
    return [...map.values()];
  }

  function userOptions() {
    return combinedUsers().map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name || u.username || "임직원")}${u.department ? ` · ${escapeHtml(u.department)}` : ""}<[REDACTED]>`).join("");
  }

  function populateUsers(panel) {
    const options = `<option value="">임직원 선택<[REDACTED]>${userOptions()}`;
    ["#perAndroidUser", "#perPlaudUser"].forEach((selector) => {
      const select = panel.querySelector(selector);
      if (!select) return;
      const current = select.value;
      select.innerHTML = options;
      if ([...select.options].some((o) => o.value === current)) select.value = current;
    });
  }

  function formatDate(value) {
    if (!value) return "-";
    try { return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch (_) { return "-"; }
  }

  function showMessage(panel, selector, text, kind = "") {
    const el = panel.querySelector(selector);
    if (!el) return;
    el.textContent = text;
    el.className = `per-message show${kind ? ` ${kind}` : ""}`;
  }

  function clearMessage(panel, selector) {
    const el = panel.querySelector(selector);
    if (el) el.className = "per-message";
  }

  function setProgress(panel, selector, status, text) {
    const row = panel.querySelector(selector);
    if (!row) return;
    row.className = `per-progress-row ${status || ""}`;
    const span = row.querySelector("span");
    if (span) span.textContent = text;
  }

  function renderTable(panel) {
    const body = panel.querySelector("#perDeviceBody");
    if (!body) return;
    const rows = [];
    androidState.items.forEach((item) => {
      const ok = item.status === "registered";
      rows.push(`<tr><td><b>Android</b></td><td>${escapeHtml(item.device_name || "Android 단말")}<br><small>${escapeHtml([item.manufacturer, item.model, item.android_version ? `Android ${item.android_version}` : ""].filter(Boolean).join(" · ") || "등록코드 대기")}</small></td><td>${escapeHtml(item.assigned_user_name || "-")}</td><td>${item.install_id ? escapeHtml(`…${item.install_id.slice(-10)}`) : "등록코드 대기"}</td><td><span class="per-status ${ok ? "ok" : ""}">${ok ? "등록 완료" : "앱 등록 대기"}</span></td><td>${formatDate(item.last_seen_at || item.claimed_at)}</td><td><div class="per-row-actions"><button class="per-btn secondary" data-android-action="code" data-id="${escapeHtml(item.id)}">새 코드</button><button class="per-btn danger" data-android-action="delete" data-id="${escapeHtml(item.id)}">삭제</button></div></td></tr>`);
    });
    plaudState.items.forEach((item) => {
      const bound = item.bind_status === "bound" || item.cloud_is_bind === true;
      const failed = item.bind_status === "bind_failed";
      rows.push(`<tr><td><b>PLAUD</b></td><td>${escapeHtml(item.device_name || item.model || "PLAUD 기기")}<br><small>${escapeHtml(item.model || item.device_type || "")}</small></td><td>${escapeHtml(item.assigned_user_name || "-")}</td><td>${escapeHtml(item.serial_number || "-")}</td><td><span class="per-status ${bound ? "ok" : failed ? "fail" : ""}">${bound ? "Cloud Bind 완료" : failed ? "Bind 실패" : "등록 완료"}</span></td><td>${formatDate(item.last_seen_at || item.last_cloud_check_at)}</td><td><div class="per-row-actions"><button class="per-btn secondary" data-plaud-action="status" data-id="${escapeHtml(item.id)}">상태확인</button>${bound ? `<button class="per-btn" data-plaud-action="unbind" data-id="${escapeHtml(item.id)}">Unbind</button>` : `<button class="per-btn secondary" data-plaud-action="bind" data-id="${escapeHtml(item.id)}">Bind</button><button class="per-btn danger" data-plaud-action="delete" data-id="${escapeHtml(item.id)}">삭제</button>`}</div></td></tr>`);
    });
    body.innerHTML = rows.length ? rows.join("") : `<tr><td colspan="7" class="per-empty">등록된 Android/PLAUD 기기가 없습니다. 위 1단계부터 순서대로 진행해 주세요.</td></tr>`;
    const summary = panel.querySelector("#perSummary");
    if (summary) summary.textContent = `Android ${androidState.items.length}대 · PLAUD ${plaudState.items.length}대`;
  }

  async function loadAll(panel) {
    const [androidResult, plaudResult] = await Promise.allSettled([
      api("/api/android-devices"),
      api("/api/plaud-devices"),
    ]);

    if (androidResult.status === "fulfilled") androidState = normalizeList(androidResult.value);
    else {
      androidState = normalizeList({});
      showMessage(panel, "#perAndroidMessage", `Android Registry: ${androidResult.reason.message}`, "error");
    }

    if (plaudResult.status === "fulfilled") plaudState = normalizeList(plaudResult.value);
    else {
      plaudState = normalizeList({});
      showMessage(panel, "#perPlaudMessage", `PLAUD Registry: ${plaudResult.reason.message}`, "error");
    }

    populateUsers(panel);
    renderTable(panel);
  }

  async function createAndroidCode(panel, button) {
    clearMessage(panel, "#perAndroidMessage");
    const assigned = panel.querySelector("#perAndroidUser")?.value;
    const name = panel.querySelector("#perAndroidName")?.value.trim();
    if (!assigned) return showMessage(panel, "#perAndroidMessage", "Android 단말을 사용할 임직원을 선택해 주세요.", "error");
    button.disabled = true;
    try {
      const result = await api("/api/android-devices", { method: "POST", body: JSON.stringify({ assigned_user_id: assigned, device_name: name }) });
      latestAndroidCode = result.registration_code || null;
      const box = panel.querySelector("#perAndroidCodeBox");
      const code = panel.querySelector("#perAndroidCode");
      if (code) code.textContent = latestAndroidCode || "코드 발급 실패";
      if (box) box.classList.toggle("show", Boolean(latestAndroidCode));
      showMessage(panel, "#perAndroidMessage", "등록코드가 발급되었습니다. Android MedPark 앱에서 이 코드를 입력해 주세요.");
      await loadAll(panel);
    } catch (error) {
      showMessage(panel, "#perAndroidMessage", error.message, "error");
    } finally { button.disabled = false; }
  }

  function selectedUserById(id) {
    return combinedUsers().find((u) => String(u.id) === String(id));
  }

  async function registerPlaud(panel, button) {
    clearMessage(panel, "#perPlaudMessage");
    const modelType = panel.querySelector("#perPlaudModel")?.value;
    const serial = panel.querySelector("#perPlaudSerial")?.value.trim();
    const userId = panel.querySelector("#perPlaudUser")?.value;
    if (!modelType) return showMessage(panel, "#perPlaudMessage", "PLAUD 모델을 선택해 주세요.", "error");
    if (!serial) return showMessage(panel, "#perPlaudMessage", "기기의 Serial Number(SN)를 입력해 주세요.", "error");
    if (!userId) return showMessage(panel, "#perPlaudMessage", "기기를 사용할 임직원을 선택해 주세요.", "error");

    const user = selectedUserById(userId) || {};
    const modelName = modelType === "notepro" ? "PLAUD Note Pro" : "PLAUD NotePin";
    const suffix = serial.slice(-6) || serial;
    const deviceName = panel.querySelector("#perPlaudName")?.value.trim() || `${modelName} · ${suffix}`;
    const partnerUser = panel.querySelector("#perPartnerUser")?.value.trim() || user.suggested_partner_user_id || "";
    const progress = panel.querySelector("#perPlaudProgress");
    progress?.classList.add("show");
    setProgress(panel, "#perStepRegistry", "wait", "등록 중");
    setProgress(panel, "#perStepCloud", "", "대기");
    setProgress(panel, "#perStepBle", "", "대기");
    button.disabled = true;

    let device = null;
    try {
      const createResult = await api("/api/plaud-devices", {
        method: "POST",
        body: JSON.stringify({
          device_name: deviceName,
          model: modelName,
          serial_number: serial,
          device_type: modelType,
          assigned_user_id: userId,
          partner_user_id: partnerUser,
        }),
      });
      device = createResult.device;
      if (!device?.id) throw new Error("기기는 등록됐지만 등록 ID를 확인하지 못했습니다.");
      setProgress(panel, "#perStepRegistry", "ok", "완료");
    } catch (error) {
      setProgress(panel, "#perStepRegistry", "fail", "실패");
      showMessage(panel, "#perPlaudMessage", error.message, "error");
      button.disabled = false;
      await loadAll(panel);
      return;
    }

    if (!plaudState.plaud_configured) {
      setProgress(panel, "#perStepCloud", "wait", "API 인증정보 필요");
      setProgress(panel, "#perStepBle", "wait", "Cloud Bind 후 진행");
      showMessage(panel, "#perPlaudMessage", "MedPark 등록은 완료됐습니다. PLAUD Developer API 인증정보를 확인한 뒤 목록의 Bind 버튼을 눌러 주세요.", "warn");
      button.disabled = false;
      await loadAll(panel);
      return;
    }

    try {
      setProgress(panel, "#perStepCloud", "wait", "연결 중");
      await api(`/api/plaud-devices/${encodeURIComponent(device.id)}/bind`, { method: "POST" });
      setProgress(panel, "#perStepCloud", "ok", "완료");
      setProgress(panel, "#perStepBle", "wait", "Android 앱에서 진행");
      showMessage(panel, "#perPlaudMessage", "PLAUD Cloud Bind까지 완료됐습니다. 이제 Android MedPark 앱에서 Bluetooth 권한을 허용하고 PLAUD 기기를 검색해 BLE Bind/Handshake를 완료해 주세요.");
      panel.querySelector("#perPlaudSerial").value = "";
      panel.querySelector("#perPlaudName").value = "";
    } catch (error) {
      setProgress(panel, "#perStepCloud", "fail", "실패");
      setProgress(panel, "#perStepBle", "wait", "Cloud Bind 필요");
      showMessage(panel, "#perPlaudMessage", `MedPark 등록은 완료됐지만 PLAUD Cloud Bind에 실패했습니다. ${error.message}`, "warn");
    } finally {
      button.disabled = false;
      await loadAll(panel);
    }
  }

  async function androidAction(panel, button) {
    const item = androidState.items.find((d) => String(d.id) === String(button.dataset.id));
    if (!item) return;
    const action = button.dataset.androidAction;
    button.disabled = true;
    try {
      if (action === "delete") {
        if (!confirm(`'${item.device_name}' Android 등록정보를 삭제하시겠습니까?`)) return;
        await api(`/api/android-devices/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        showMessage(panel, "#perAndroidMessage", "Android 단말 등록정보를 삭제했습니다.");
      } else if (action === "code") {
        const result = await api(`/api/android-devices/${encodeURIComponent(item.id)}/code`, { method: "POST" });
        latestAndroidCode = result.registration_code || null;
        const box = panel.querySelector("#perAndroidCodeBox");
        const code = panel.querySelector("#perAndroidCode");
        if (code) code.textContent = latestAndroidCode || "코드 발급 실패";
        if (box) box.classList.toggle("show", Boolean(latestAndroidCode));
        showMessage(panel, "#perAndroidMessage", "새 Android 등록코드가 발급되었습니다. 기존 단말 연결정보는 재등록 대기 상태로 변경됩니다.", "warn");
      }
      await loadAll(panel);
    } catch (error) {
      showMessage(panel, "#perAndroidMessage", error.message, "error");
    } finally { button.disabled = false; }
  }

  async function plaudAction(panel, button) {
    const item = plaudState.items.find((d) => String(d.id) === String(button.dataset.id));
    if (!item) return;
    const action = button.dataset.plaudAction;
    button.disabled = true;
    try {
      if (action === "delete") {
        if (!confirm(`'${item.device_name}' PLAUD 등록정보를 삭제하시겠습니까?`)) return;
        await api(`/api/plaud-devices/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      } else if (action === "bind") {
        await api(`/api/plaud-devices/${encodeURIComponent(item.id)}/bind`, { method: "POST" });
        showMessage(panel, "#perPlaudMessage", "PLAUD Cloud Bind가 완료됐습니다. Android 앱에서 BLE Bind를 이어서 진행해 주세요.");
      } else if (action === "unbind") {
        if (!confirm(`'${item.device_name}'의 PLAUD Cloud Bind를 해제하시겠습니까?`)) return;
        await api(`/api/plaud-devices/${encodeURIComponent(item.id)}/unbind`, { method: "POST" });
      } else if (action === "status") {
        await api(`/api/plaud-devices/${encodeURIComponent(item.id)}/status`, { method: "POST" });
      }
      await loadAll(panel);
    } catch (error) {
      showMessage(panel, "#perPlaudMessage", error.message, "error");
    } finally { button.disabled = false; }
  }

  document.addEventListener("change", (event) => {
    const panel = event.target.closest(`#${PANEL_ID}`);
    if (!panel) return;
    if (event.target.id === "perPlaudUser") {
      const user = selectedUserById(event.target.value);
      const partner = panel.querySelector("#perPartnerUser");
      if (partner && !partner.value.trim()) partner.value = user?.suggested_partner_user_id || "";
    }
  }, true);

  document.addEventListener("click", async (event) => {
    const panel = event.target.closest(`#${PANEL_ID}`);
    if (!panel) return;
    const androidCreate = event.target.closest("#perAndroidCreate");
    if (androidCreate) { event.preventDefault(); await createAndroidCode(panel, androidCreate); return; }
    const copy = event.target.closest("#perCopyAndroidCode");
    if (copy) {
      event.preventDefault();
      if (!latestAndroidCode) return;
      try { await navigator.clipboard.writeText(latestAndroidCode); copy.textContent = "복사 완료"; setTimeout(() => { copy.textContent = "코드 복사"; }, 1200); } catch (_) { alert(latestAndroidCode); }
      return;
    }
    const plaudRegister = event.target.closest("#perPlaudRegister");
    if (plaudRegister) { event.preventDefault(); await registerPlaud(panel, plaudRegister); return; }
    const androidButton = event.target.closest("[data-android-action]");
    if (androidButton) { event.preventDefault(); await androidAction(panel, androidButton); return; }
    const plaudButton = event.target.closest("[data-plaud-action]");
    if (plaudButton) { event.preventDefault(); await plaudAction(panel, plaudButton); }
  }, true);

  function attach() {
    ensureStyle();
    const panel = ensurePanel();
    if (!panel || panel.dataset.easyLoaded === "1") return;
    panel.dataset.easyLoaded = "1";
    loadAll(panel);
  }

  ensureStyle();
  new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", attach);
  window.addEventListener("load", attach);
  attach();
})();
