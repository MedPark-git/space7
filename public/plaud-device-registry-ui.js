(() => {
  if (window.__MEDPARK_PLAUD_REGISTRY_UI__) return;
  window.__MEDPARK_PLAUD_REGISTRY_UI__ = true;

  const PANEL_ID = "plaudDeviceDirectRegistry";
  const STYLE_ID = "plaudDeviceRegistryUiStyle";
  let state = { items: [], users: [], can_manage: null, plaud_configured: false };
  let partnerTouched = false;
  let loading = false;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[ch]));

  async function api(url, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) {}
    if (!response.ok) throw new Error(data.message || `요청 실패 (HTTP ${response.status})`);
    return data;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .pdr-panel{margin:0 0 18px;padding:18px;border:1px solid #c7e0d7;border-radius:16px;background:linear-gradient(135deg,#fff 0%,#f3faf7 100%);box-shadow:0 10px 28px rgba(7,84,72,.07)}
      .pdr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}.pdr-title{display:flex;align-items:flex-start;gap:11px}.pdr-icon{width:40px;height:40px;display:grid;place-items:center;flex:none;border-radius:12px;background:linear-gradient(145deg,#087b66,#0aa17f);box-shadow:0 8px 20px rgba(7,84,72,.16)}.pdr-icon svg{width:28px;height:28px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.pdr-icon .badge{fill:#f4c95d;stroke:#fff}.pdr-icon .plus{stroke:#173e35;stroke-width:2.4}.pdr-kicker{display:block;color:#087563;font-size:8px;font-weight:900;letter-spacing:1px}.pdr-head h3{margin:4px 0;color:#163f36;font-size:16px}.pdr-head p{margin:0;max-width:840px;color:#778783;font-size:8px;line-height:1.6}.pdr-count{flex:none;padding:7px 10px;border:1px solid #d9e7e2;border-radius:9px;background:#fff;color:#56706a;font-size:8px;font-weight:850}
      .pdr-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0}.pdr-api-status{display:flex;align-items:center;gap:7px;color:#71817c;font-size:8px}.pdr-dot{width:7px;height:7px;border-radius:50%;background:#caa243;box-shadow:0 0 0 3px #fff3cd}.pdr-dot.ready{background:#16a77c;box-shadow:0 0 0 3px #dff5ed}.pdr-toggle{display:inline-flex;align-items:center;gap:7px;padding:10px 14px;border:0;border-radius:10px;background:#087563;color:#fff;font-size:10px;font-weight:850;box-shadow:0 7px 16px rgba(8,117,99,.18);cursor:pointer}.pdr-toggle:hover{background:#075f51}
      .pdr-form{display:block;margin:10px 0 14px;padding:14px;border:1px solid #cfe3dc;border-radius:12px;background:#f8fcfa}.pdr-form[hidden]{display:none!important}.pdr-form-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:11px}.pdr-form-head h4{margin:0 0 4px;color:#23443c;font-size:11px}.pdr-form-head p{margin:0;color:#7c8a86;font-size:8px}.pdr-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.pdr-form label{display:grid;gap:5px;color:#596963;font-size:8px;font-weight:800}.pdr-form input,.pdr-form select{width:100%;height:36px;padding:0 10px;border:1px solid #d5e2de;border-radius:8px;background:#fff;color:#30443e;font-size:9px;outline:none}.pdr-form input:focus,.pdr-form select:focus{border-color:#0a9b7e;box-shadow:0 0 0 3px rgba(10,155,126,.1)}.pdr-form small{color:#8b9793;font-size:7px;font-weight:500}.pdr-warning{margin-top:9px;padding:9px 10px;border:1px solid #ead9ad;border-radius:8px;background:#fffaf0;color:#7c6429;font-size:7px;line-height:1.55}.pdr-message{display:none;margin-top:9px;padding:8px 10px;border-radius:8px;background:#eef7f4;color:#37675b;font-size:8px}.pdr-message.show{display:block}.pdr-message.error{background:#fff1ef;color:#9f4f47}.pdr-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:11px}.pdr-btn{height:32px;padding:0 11px;border:1px solid #d5e2de;border-radius:8px;background:#fff;color:#586a64;font-size:8px;font-weight:850;cursor:pointer}.pdr-btn.primary{border-color:#087563;background:#087563;color:#fff}.pdr-btn:disabled{opacity:.45;cursor:not-allowed}
      .pdr-table-wrap{overflow-x:auto;border:1px solid #dce8e4;border-radius:11px;background:#fff}.pdr-table{width:100%;min-width:900px;border-collapse:collapse}.pdr-table th{padding:8px 9px;background:#f3f8f6;border-bottom:1px solid #dce8e4;color:#71827d;font-size:7px;text-align:left;white-space:nowrap}.pdr-table td{padding:10px 9px;border-bottom:1px solid #edf2f0;color:#566761;font-size:8px;white-space:nowrap}.pdr-empty{padding:20px!important;text-align:center;color:#8a9793!important}.pdr-row-actions{display:flex;gap:4px;flex-wrap:wrap}.pdr-mini{height:26px;padding:0 7px;border:1px solid #d8e5e0;border-radius:7px;background:#fff;color:#52635d;font-size:7px;font-weight:850;cursor:pointer}.pdr-mini.bind{border-color:#aad8cb;background:#edf8f4;color:#08715e}.pdr-mini.unbind{border-color:#e9d29b;background:#fff8e8;color:#88651e}.pdr-mini.delete{border-color:#eccdca;background:#fff7f5;color:#a24e48}.pdr-mini:disabled{opacity:.45;cursor:not-allowed}.pdr-state{display:inline-flex;align-items:center;gap:4px;padding:4px 6px;border-radius:6px;background:#fff5dc;color:#8a671f;font-size:7px;font-weight:850}.pdr-state.bound{background:#e8f7f1;color:#08745e}.pdr-state.bind_failed{background:#fff0ee;color:#a14d46}
      @media(max-width:900px){.pdr-form-grid{grid-template-columns:1fr 1fr}}@media(max-width:640px){.pdr-head,.pdr-toolbar{flex-direction:column;align-items:flex-start}.pdr-form-grid{grid-template-columns:1fr}.pdr-toggle{width:100%;justify-content:center}}
    `;
    document.head.appendChild(style);
  }

  function isPlaudPage() {
    const root = document.getElementById("pageContent");
    const title = root?.querySelector(".plaud-page-heading h1, .page-heading h1");
    return Boolean(title && /회의록[_\s-]*Plaud/i.test(title.textContent || ""));
  }

  function icon() {
    return `<span class="pdr-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><rect x="12" y="7" width="20" height="32" rx="6"></rect><path d="M18 13h8M18 31h8"></path><circle cx="22" cy="23" r="4"></circle><circle cx="35" cy="34" r="9" class="badge"></circle><path d="M35 30v8M31 34h8" class="plus"></path></svg></span>`;
  }

  function ensurePanel() {
    if (!isPlaudPage()) return null;
    const root = document.getElementById("pageContent");
    let panel = root?.querySelector(`#${PANEL_ID}`);
    if (panel) return panel;
    const heading = root?.querySelector(".plaud-page-heading, .page-heading");
    if (!root || !heading) return null;
    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "pdr-panel";
    panel.innerHTML = `
      <div class="pdr-head">
        <div class="pdr-title">${icon()}<div><span class="pdr-kicker">DEVICE REGISTRATION & CONNECTION</span><h3>PLAUD 기기 연결 및 등록</h3><p>PLAUD 기기를 MedPark에 등록하고 사용자 할당, Cloud Bind, 연결상태 확인과 Unbind를 관리합니다.</p></div></div>
        <div class="pdr-count" id="pdrCount">0대 등록</div>
      </div>
      <div class="pdr-toolbar"><div class="pdr-api-status"><i class="pdr-dot" id="pdrDot"></i><span id="pdrApiText">Registry 연결 확인 중</span></div><button type="button" class="pdr-toggle" id="pdrToggleForm">＋ 기기 등록</button></div>
      <div class="pdr-form" id="pdrForm">
        <div class="pdr-form-head"><div><h4>PLAUD 기기 실제 등록</h4><p>Serial Number와 사용자 정보를 등록한 뒤 목록에서 PLAUD Cloud Bind를 진행합니다.</p></div></div>
        <div class="pdr-form-grid">
          <label>기기명<input id="pdrDeviceName" maxlength="120" placeholder="예: 대표회의실 Note Pro"><small>관리용 표시명</small></label>
          <label>모델<input id="pdrModel" maxlength="80" placeholder="예: PLAUD Note Pro"><small>선택 입력</small></label>
          <label>Serial Number<input id="pdrSerial" maxlength="128" placeholder="기기 SN" required><small>기기 본체 또는 SDK에서 확인</small></label>
          <label>Device Type<select id="pdrDeviceType"><option value="">SN 기준 자동판단</option><option value="notepro">notepro (881)</option><option value="notepins">notepins (882)</option></select><small>PLAUD Bind API type</small></label>
          <label>할당 사용자<select id="pdrAssignedUser"><option value="">임직원 선택</option></select><small>기기 소유/사용자</small></label>
          <label>Partner User ID<input id="pdrPartnerUserId" minlength="6" maxlength="255" placeholder="6자 이상"><small>PLAUD User Token 식별자</small></label>
        </div>
        <div class="pdr-warning"><b>중요:</b> 웹에서는 MedPark Registry 등록과 PLAUD Cloud Bind까지 처리합니다. 실제 물리 기기 사용을 위해 Android 앱의 BLE Bind/Handshake가 추가로 필요합니다.</div>
        <div class="pdr-message" id="pdrMessage"></div>
        <div class="pdr-actions"><button type="button" class="pdr-btn" id="pdrClear">입력 초기화</button><button type="button" class="pdr-btn primary" id="pdrSubmit">기기 등록</button></div>
      </div>
      <div class="pdr-table-wrap"><table class="pdr-table"><thead><tr><th>등록기기</th><th>모델</th><th>Serial Number</th><th>Device Type</th><th>할당 사용자</th><th>Partner User ID</th><th>PLAUD Bind</th><th>연결상태</th><th>최종 연결</th><th>관리</th></tr></thead><tbody id="pdrBody"><tr><td colspan="10" class="pdr-empty">등록기기 정보를 불러오는 중입니다.</td></tr></tbody></table></div>`;
    heading.insertAdjacentElement("afterend", panel);
    return panel;
  }

  function populateUsers(panel) {
    const select = panel.querySelector("#pdrAssignedUser");
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">임직원 선택</option>${state.users.map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name || u.username)}${u.department ? ` · ${escapeHtml(u.department)}` : ""}</option>`).join("")}`;
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  }

  function formatDate(value) {
    if (!value) return "-";
    try { return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch (_) { return "-"; }
  }

  function renderRows(panel) {
    const body = panel.querySelector("#pdrBody");
    if (!body) return;
    if (!state.items.length) {
      body.innerHTML = `<tr><td colspan="10" class="pdr-empty">등록된 PLAUD 기기가 없습니다. 위 등록 폼에서 실제 기기를 등록해 주세요.</td></tr>`;
      return;
    }
    body.innerHTML = state.items.map((item) => {
      const bound = item.bind_status === "bound" || item.cloud_is_bind === true;
      const statusClass = item.bind_status === "bound" ? "bound" : item.bind_status === "bind_failed" ? "bind_failed" : "";
      const statusLabel = item.bind_status === "bound" ? "PLAUD Bound" : item.bind_status === "bind_failed" ? "Bind 실패" : item.bind_status === "unbound" ? "Unbound" : "등록완료";
      return `<tr><td><b>${escapeHtml(item.device_name || "PLAUD Device")}</b></td><td>${escapeHtml(item.model || "-")}</td><td>${escapeHtml(item.serial_number)}</td><td>${escapeHtml(item.device_type)}</td><td>${escapeHtml(item.assigned_user_name || "-")}</td><td>${escapeHtml(item.partner_user_id || "-")}</td><td><span class="pdr-state ${statusClass}">${statusLabel}</span></td><td>${item.ble_status === "connected" ? "BLE 연결" : "Android BLE 필요"}</td><td>${formatDate(item.last_seen_at || item.last_cloud_check_at)}</td><td><div class="pdr-row-actions"><button type="button" class="pdr-mini" data-pdr-action="status" data-id="${item.id}">상태확인</button>${bound ? `<button type="button" class="pdr-mini unbind" data-pdr-action="unbind" data-id="${item.id}">Cloud Unbind</button>` : `<button type="button" class="pdr-mini bind" data-pdr-action="bind" data-id="${item.id}" ${state.plaud_configured ? "" : "disabled"}>PLAUD 바인딩</button><button type="button" class="pdr-mini delete" data-pdr-action="delete" data-id="${item.id}">등록삭제</button>`}</div></td></tr>`;
    }).join("");
  }

  function renderStatus(panel) {
    panel.querySelector("#pdrCount").textContent = `${state.items.length}대 등록 · ${state.items.filter((d) => d.bind_status === "bound").length}대 Bound`;
    panel.querySelector("#pdrDot").className = `pdr-dot${state.plaud_configured ? " ready" : ""}`;
    panel.querySelector("#pdrApiText").textContent = state.plaud_configured ? "PLAUD Developer API 연결 준비됨" : "Registry 등록 가능 · PLAUD API 인증정보 확인 필요";
    populateUsers(panel);
    renderRows(panel);
  }

  function message(panel, text, isError = false) {
    const el = panel.querySelector("#pdrMessage");
    if (!el) return;
    el.textContent = text;
    el.className = `pdr-message show${isError ? " error" : ""}`;
  }

  async function load(panel) {
    if (!panel || loading) return;
    loading = true;
    try {
      state = await api("/api/plaud-devices");
      renderStatus(panel);
    } catch (error) {
      panel.querySelector("#pdrApiText").textContent = `Registry API 오류: ${error.message}`;
      message(panel, error.message, true);
    } finally { loading = false; }
  }

  function clearForm(panel) {
    ["#pdrDeviceName", "#pdrModel", "#pdrSerial", "#pdrPartnerUserId"].forEach((s) => { const el = panel.querySelector(s); if (el) el.value = ""; });
    const type = panel.querySelector("#pdrDeviceType"); if (type) type.value = "";
    const user = panel.querySelector("#pdrAssignedUser"); if (user) user.value = "";
    partnerTouched = false;
    const msg = panel.querySelector("#pdrMessage"); if (msg) msg.className = "pdr-message";
  }

  async function submit(panel, button) {
    const payload = {
      device_name: panel.querySelector("#pdrDeviceName")?.value.trim(),
      model: panel.querySelector("#pdrModel")?.value.trim(),
      serial_number: panel.querySelector("#pdrSerial")?.value.trim(),
      device_type: panel.querySelector("#pdrDeviceType")?.value,
      assigned_user_id: panel.querySelector("#pdrAssignedUser")?.value,
      partner_user_id: panel.querySelector("#pdrPartnerUserId")?.value.trim()
    };
    if (!payload.serial_number || !payload.assigned_user_id) return message(panel, "Serial Number와 할당 사용자를 입력해 주세요.", true);
    button.disabled = true;
    try {
      await api("/api/plaud-devices", { method: "POST", body: JSON.stringify(payload) });
      clearForm(panel);
      message(panel, "기기가 MedPark Registry에 등록되었습니다.");
      await load(panel);
    } catch (error) { message(panel, error.message, true); }
    finally { button.disabled = false; }
  }

  async function deviceAction(panel, button) {
    const id = button.dataset.id;
    const action = button.dataset.pdrAction;
    const item = state.items.find((d) => d.id === id);
    if (!item) return;
    let endpoint = `/api/plaud-devices/${encodeURIComponent(id)}/${action}`;
    let method = "POST";
    if (action === "delete") {
      if (!confirm(`'${item.device_name}' 등록정보를 삭제하시겠습니까?`)) return;
      endpoint = `/api/plaud-devices/${encodeURIComponent(id)}`;
      method = "DELETE";
    }
    if (action === "bind" && !confirm(`PLAUD Cloud에 '${item.device_name}' 기기를 바인딩하시겠습니까?`)) return;
    if (action === "unbind" && !confirm(`'${item.device_name}' 기기의 PLAUD Cloud 바인딩을 해제하시겠습니까?`)) return;
    button.disabled = true;
    try {
      const result = await api(endpoint, { method });
      if (result.message) message(panel, result.message);
      await load(panel);
    } catch (error) { message(panel, error.message, true); }
    finally { button.disabled = false; }
  }

  document.addEventListener("click", async (event) => {
    const panel = event.target.closest(`#${PANEL_ID}`);
    if (!panel) return;
    const toggle = event.target.closest("#pdrToggleForm");
    if (toggle) {
      event.preventDefault();
      const form = panel.querySelector("#pdrForm");
      form.hidden = !form.hidden;
      toggle.textContent = form.hidden ? "＋ 기기 등록" : "－ 등록 폼 닫기";
      if (!form.hidden) panel.querySelector("#pdrSerial")?.focus();
      return;
    }
    const clear = event.target.closest("#pdrClear");
    if (clear) { event.preventDefault(); clearForm(panel); return; }
    const submitButton = event.target.closest("#pdrSubmit");
    if (submitButton) { event.preventDefault(); await submit(panel, submitButton); return; }
    const actionButton = event.target.closest("[data-pdr-action]");
    if (actionButton) { event.preventDefault(); await deviceAction(panel, actionButton); }
  }, true);

  document.addEventListener("change", (event) => {
    const panel = event.target.closest(`#${PANEL_ID}`);
    if (!panel) return;
    if (event.target.id === "pdrAssignedUser") {
      const user = state.users.find((u) => String(u.id) === event.target.value);
      const input = panel.querySelector("#pdrPartnerUserId");
      if (user && input && !partnerTouched) input.value = user.suggested_partner_user_id || "";
    }
  }, true);

  document.addEventListener("input", (event) => {
    const panel = event.target.closest(`#${PANEL_ID}`);
    if (!panel) return;
    if (event.target.id === "pdrPartnerUserId") partnerTouched = true;
    if (event.target.id === "pdrSerial") {
      const type = panel.querySelector("#pdrDeviceType");
      if (!type || type.value) return;
      if (event.target.value.startsWith("881")) type.value = "notepro";
      if (event.target.value.startsWith("882")) type.value = "notepins";
    }
  }, true);

  function attach() {
    ensureStyle();
    const panel = ensurePanel();
    if (!panel || panel.dataset.loaded === "1") return;
    panel.dataset.loaded = "1";
    load(panel);
  }

  ensureStyle();
  new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", attach);
  window.addEventListener("load", attach);
  attach();
})();