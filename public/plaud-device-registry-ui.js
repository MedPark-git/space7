(() => {
  const ROOT_SELECTOR = ".peg-device-registry";
  const DIRECT_ID = "plaudDeviceDirectRegistry";
  const STYLE_ID = "plaudDeviceRegistryUiStyle";
  let state = { items: [], users: [], can_manage: null, plaud_configured: false };
  let partnerTouched = false;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'\"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '\"': "&quot;"
  }[char]));

  const api = async (url, options = {}) => {
    const headers = { accept: "application/json", ...(options.headers || {}) };
    if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
    const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {}
    if (!response.ok) throw new Error(data.message || `요청 실패 (HTTP ${response.status})`);
    return data;
  };

  const formatDate = (value) => {
    if (!value) return "-";
    try {
      return new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
      }).format(new Date(value));
    } catch { return "-"; }
  };

  const iconSvg = `
    <span class="pdr-title-icon" aria-hidden="true">
      <svg viewBox="0 0 48 48" role="img">
        <rect x="12" y="7" width="20" height="32" rx="6"></rect>
        <path d="M18 13h8M18 31h8"></path>
        <circle cx="22" cy="23" r="4"></circle>
        <circle cx="35" cy="34" r="9" class="pdr-icon-badge"></circle>
        <path d="M35 30v8M31 34h8" class="pdr-icon-plus"></path>
      </svg>
    </span>`;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .pdr-direct-panel{margin:0 0 18px;padding:18px;border:1px solid #c7e0d7;border-radius:16px;background:linear-gradient(135deg,#fff 0%,#f3faf7 100%);box-shadow:0 10px 28px rgba(7,84,72,.07)}
      .pdr-direct-panel .peg-reg-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:10px}.pdr-direct-panel .peg-reg-head>div:first-child>span{display:block;color:#087563;font-size:8px;font-weight:900;letter-spacing:1px}.pdr-direct-panel .peg-reg-head h3{margin:4px 0;color:#163f36;font-size:15px}.pdr-direct-panel .peg-reg-head p{max-width:900px;margin:0;color:#778783;font-size:8px;line-height:1.55}.pdr-direct-panel .peg-reg-badge{flex:none;padding:7px 9px;border:1px solid #d9e7e2;border-radius:9px;background:#f7fbf9;color:#56706a;font-size:8px;font-weight:850}
      .pdr-direct-panel .peg-reg-flow{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px;margin:10px 0}.pdr-direct-panel .peg-reg-step{padding:8px;border:1px solid #e0ebe7;border-radius:9px;background:#fbfdfc;text-align:center}.pdr-direct-panel .peg-reg-step b{display:grid;place-items:center;width:20px;height:20px;margin:0 auto 4px;border-radius:6px;background:#e7f5ef;color:#08735f;font-size:8px}.pdr-direct-panel .peg-reg-step span{color:#536660;font-size:7px;font-weight:800}
      .pdr-direct-panel .peg-reg-table-wrap{overflow-x:auto;border:1px solid #dce8e4;border-radius:11px;background:#fff}.pdr-direct-panel .peg-reg-table{width:100%;min-width:900px;border-collapse:collapse}.pdr-direct-panel .peg-reg-table th{padding:8px 9px;background:#f3f8f6;border-bottom:1px solid #dce8e4;color:#71827d;font-size:7px;text-align:left;white-space:nowrap}.pdr-direct-panel .peg-reg-table td{padding:10px 9px;border-bottom:1px solid #edf2f0;color:#566761;font-size:8px;white-space:nowrap}
      .pdr-title-wrap{display:flex;align-items:center;gap:10px}.pdr-title-icon{width:38px;height:38px;display:grid;place-items:center;flex:none;border-radius:12px;background:linear-gradient(145deg,#087b66,#0aa17f);box-shadow:0 8px 20px rgba(7,84,72,.16)}.pdr-title-icon svg{width:27px;height:27px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.pdr-title-icon .pdr-icon-badge{fill:#f4c95d;stroke:#fff}.pdr-title-icon .pdr-icon-plus{stroke:#173e35;stroke-width:2.4}
      .pdr-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0}.pdr-status-line{display:flex;align-items:center;gap:7px;color:#71817c;font-size:8px}.pdr-status-dot{width:7px;height:7px;border-radius:50%;background:#caa243;box-shadow:0 0 0 3px #fff3cd}.pdr-status-dot.ready{background:#16a77c;box-shadow:0 0 0 3px #dff5ed}.pdr-add-button{display:inline-flex;align-items:center;gap:7px;padding:10px 14px;border:0;border-radius:10px;background:#087563;color:#fff;font-size:10px;font-weight:850;box-shadow:0 7px 16px rgba(8,117,99,.18);cursor:pointer}.pdr-add-button:hover{background:#075f51;transform:translateY(-1px)}
      .pdr-form{display:none;margin:10px 0 14px;padding:14px;border:1px solid #cfe3dc;border-radius:12px;background:#f8fcfa}.pdr-form.open{display:block}.pdr-form-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:11px}.pdr-form-head h4{margin:0 0 4px;color:#23443c;font-size:11px}.pdr-form-head p{margin:0;color:#7c8a86;font-size:8px}.pdr-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.pdr-form label{display:grid;gap:5px;color:#596963;font-size:8px;font-weight:800}.pdr-form input,.pdr-form select{width:100%;height:36px;padding:0 10px;border:1px solid #d5e2de;border-radius:8px;background:#fff;color:#30443e;font-size:9px;outline:none}.pdr-form input:focus,.pdr-form select:focus{border-color:#0a9b7e;box-shadow:0 0 0 3px rgba(10,155,126,.1)}.pdr-form small{color:#8b9793;font-size:7px;font-weight:500;line-height:1.45}.pdr-form-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:11px}.pdr-btn{height:32px;padding:0 10px;border:1px solid #d5e2de;border-radius:8px;background:#fff;color:#586a64;font-size:8px;font-weight:850;cursor:pointer}.pdr-btn.primary{border-color:#087563;background:#087563;color:#fff}.pdr-btn:disabled{cursor:not-allowed;opacity:.45}.pdr-message{display:none;margin-top:9px;padding:8px 10px;border-radius:8px;background:#eef7f4;color:#37675b;font-size:8px}.pdr-message.show{display:block}.pdr-message.error{background:#fff1ef;color:#9f4f47}
      .pdr-table-actions{display:flex;gap:4px;flex-wrap:wrap}.pdr-mini{height:26px;padding:0 7px;border:1px solid #d8e5e0;border-radius:7px;background:#fff;color:#52635d;font-size:7px;font-weight:850;cursor:pointer}.pdr-mini.bind{border-color:#aad8cb;background:#edf8f4;color:#08715e}.pdr-mini.unbind{border-color:#e9d29b;background:#fff8e8;color:#88651e}.pdr-mini.delete{border-color:#eccdca;background:#fff7f5;color:#a24e48}.pdr-mini:disabled{opacity:.45;cursor:not-allowed}.pdr-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 6px;border-radius:6px;font-size:7px;font-weight:850;white-space:nowrap}.pdr-badge::before{content:"";width:5px;height:5px;border-radius:50%}.pdr-badge.registered,.pdr-badge.unbound{background:#fff5dc;color:#8a671f}.pdr-badge.registered::before,.pdr-badge.unbound::before{background:#d3a32f}.pdr-badge.bound{background:#e8f7f1;color:#08745e}.pdr-badge.bound::before{background:#12a57a}.pdr-badge.bind_failed{background:#fff0ee;color:#a14d46}.pdr-badge.bind_failed::before{background:#d75e54}.pdr-ble{color:#7f8c88;font-size:7px}.pdr-user{display:grid;gap:2px}.pdr-user b{font-size:8px;color:#425b54}.pdr-user small{font-size:7px;color:#8b9693}.pdr-sn{font:8px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:#405b53}.pdr-empty-note{display:grid;gap:4px;justify-items:center;padding:20px 10px}.pdr-empty-note strong{color:#405e55;font-size:9px}.pdr-empty-note span{color:#8a9793;font-size:8px}.pdr-warning{margin:8px 0 0;padding:9px 10px;border:1px solid #ead9ad;border-radius:8px;background:#fffaf0;color:#7c6429;font-size:7px;line-height:1.55}
      @media(max-width:980px){.pdr-form-grid{grid-template-columns:1fr 1fr}.pdr-direct-panel .peg-reg-flow{grid-template-columns:repeat(3,1fr)}}@media(max-width:640px){.pdr-form-grid{grid-template-columns:1fr}.pdr-toolbar,.pdr-direct-panel .peg-reg-head{align-items:flex-start;flex-direction:column}.pdr-add-button{width:100%;justify-content:center}.pdr-direct-panel .peg-reg-flow{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  function isPlaudPage() {
    const root = document.getElementById("pageContent");
    const title = root?.querySelector(".plaud-page-heading h1, .page-heading h1");
    return Boolean(title && /회의록[_\s-]*Plaud/i.test(title.textContent || ""));
  }

  function createDirectHost() {
    if (!isPlaudPage()) return null;
    const root = document.getElementById("pageContent");
    if (!root) return null;
    const existing = root.querySelector(`#${DIRECT_ID}`);
    if (existing) return existing;
    const heading = root.querySelector(".plaud-page-heading, .page-heading");
    if (!heading) return null;
    const host = document.createElement("section");
    host.id = DIRECT_ID;
    host.className = "peg-device-registry pdr-direct-panel";
    host.innerHTML = `
      <div class="peg-reg-head"><div><span>DEVICE REGISTRATION & CONNECTION</span><h3>PLAUD 기기 연결 및 등록</h3><p>PLAUD 기기를 MedPark에 등록하고 사용자 할당, Cloud Bind, 연결상태 확인과 Unbind를 관리합니다.</p></div><div class="peg-reg-badge">기기 Registry</div></div>
      <div class="peg-reg-flow"><div class="peg-reg-step"><b>01</b><span>기기 등록</span></div><div class="peg-reg-step"><b>02</b><span>사용자 할당</span></div><div class="peg-reg-step"><b>03</b><span>PLAUD Bind</span></div><div class="peg-reg-step"><b>04</b><span>상태 확인</span></div><div class="peg-reg-step"><b>05</b><span>Android BLE</span></div><div class="peg-reg-step"><b>06</b><span>사용</span></div></div>
      <div class="peg-reg-table-wrap"><table class="peg-reg-table"><thead><tr><th>등록기기</th><th>모델</th><th>Serial Number</th><th>Device Type</th><th>할당 사용자</th><th>Partner User ID</th><th>PLAUD Bind</th><th>연결상태</th><th>최종 연결</th><th>관리</th></tr></thead><tbody><tr><td colspan="10"><div class="pdr-empty-note"><strong>기기 정보를 불러오는 중입니다.</strong></div></td></tr></tbody></table></div>`;
    heading.insertAdjacentElement("afterend", host);
    return host;
  }

  function statusMeta(status) { const key = status || "registered"; const label = { registered: "등록완료 · Bind 대기", bound: "PLAUD Bound", unbound: "Unbound", bind_failed: "Bind 실패" }[key] || key; return { key, label }; }
  function selectedUser() { const select = document.querySelector("#pdrAssignedUser"); return select ? state.users.find((user) => String(user.id) === select.value) || null : null; }
  function syncPartnerId() { const user = selectedUser(); const input = document.querySelector("#pdrPartnerUserId"); if (!input || !user || partnerTouched) return; input.value = user.suggested_partner_user_id || ""; }

  function renderForm() {
    if (state.can_manage === false) return "";
    return `<div class="pdr-form" id="pdrRegisterFormWrap"><div class="pdr-form-head"><div><h4>PLAUD 기기 실제 등록</h4><p>Serial Number와 사용자 정보를 등록한 뒤 PLAUD Cloud Bind를 진행합니다.</p></div></div><div class="pdr-form-grid"><label>기기명<input id="pdrDeviceName" maxlength="120" placeholder="예: 대표회의실 Note Pro"><small>관리용 표시명</small></label><label>모델<input id="pdrModel" maxlength="80" placeholder="예: PLAUD Note Pro"><small>선택 입력</small></label><label>Serial Number<input id="pdrSerial" maxlength="128" placeholder="기기 SN" required><small>기기 본체 또는 SDK에서 확인</small></label><label>Device Type<select id="pdrDeviceType"><option value="">SN 기준 자동판단</option><option value="notepro">notepro (881)</option><option value="notepins">notepins (882)</option></select><small>PLAUD Bind API의 type</small></label><label>할당 사용자<select id="pdrAssignedUser" required><option value="">임직원 선택</option>${state.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name || user.username)} · ${escapeHtml(user.department || "")}</option>`).join("")}</select><small>기기 사용자</small></label><label>Partner User ID<input id="pdrPartnerUserId" minlength="6" maxlength="255" placeholder="6자 이상"><small>PLAUD User Token 사용자 식별자</small></label></div><div class="pdr-warning"><b>중요:</b> 웹에서 MedPark 등록 + PLAUD Cloud Bind까지 수행합니다. 최종 물리기기 사용을 위해 Android 앱에서 BLE Bind/Handshake가 추가로 필요합니다.</div><div id="pdrFormMessage" class="pdr-message"></div><div class="pdr-form-actions"><button type="button" class="pdr-btn" id="pdrCancel">취소</button><button type="button" class="pdr-btn primary" id="pdrSubmit">기기 등록</button></div></div>`;
  }

  function rowMarkup(item) {
    const status = statusMeta(item.bind_status), bound = item.bind_status === "bound" || item.cloud_is_bind === true, lastConnection = item.last_seen_at || item.last_cloud_check_at;
    const actions = state.can_manage ? `<div class="pdr-table-actions"><button class="pdr-mini" data-pdr-action="status" data-id="${escapeHtml(item.id)}">상태확인</button>${bound ? `<button class="pdr-mini unbind" data-pdr-action="unbind" data-id="${escapeHtml(item.id)}">Cloud Unbind</button>` : `<button class="pdr-mini bind" data-pdr-action="bind" data-id="${escapeHtml(item.id)}" ${state.plaud_configured ? "" : "disabled"}>PLAUD 바인딩</button>`}${bound ? "" : `<button class="pdr-mini delete" data-pdr-action="delete" data-id="${escapeHtml(item.id)}">등록삭제</button>`}</div>` : `<button class="pdr-mini" data-pdr-action="status" data-id="${escapeHtml(item.id)}">상태확인</button>`;
    return `<tr><td><b>${escapeHtml(item.device_name || "PLAUD Device")}</b></td><td>${escapeHtml(item.model || "-")}</td><td><span class="pdr-sn">${escapeHtml(item.serial_number)}</span></td><td>${escapeHtml(item.device_type)}</td><td><span class="pdr-user"><b>${escapeHtml(item.assigned_user_name || "-")}</b><small>${escapeHtml(item.assigned_username || "")}</small></span></td><td><span class="pdr-sn">${escapeHtml(item.partner_user_id)}</span></td><td><span class="pdr-badge ${escapeHtml(status.key)}">${escapeHtml(status.label)}</span></td><td><span class="pdr-ble">${item.ble_status === "connected" ? "BLE 연결" : "Android BLE 확인 필요"}</span></td><td>${formatDate(lastConnection)}</td><td>${actions}</td></tr>`;
  }

  function renderRegistry(host) {
    const head = host.querySelector(".peg-reg-head > div:first-child");
    if (head && !head.querySelector(".pdr-title-wrap")) { const h3 = head.querySelector("h3"); if (h3) { const wrap = document.createElement("div"); wrap.className = "pdr-title-wrap"; h3.replaceWith(wrap); wrap.innerHTML = `${iconSvg}<h3>${escapeHtml(h3.textContent)}</h3>`; } }
    let toolbar = host.querySelector(".pdr-toolbar"); if (!toolbar) { toolbar = document.createElement("div"); toolbar.className = "pdr-toolbar"; const flow = host.querySelector(".peg-reg-flow"); flow?.insertAdjacentElement("beforebegin", toolbar); }
    toolbar.innerHTML = `<div class="pdr-status-line"><i class="pdr-status-dot ${state.plaud_configured ? "ready" : ""}"></i><span>${state.plaud_configured ? "PLAUD Developer API 연결 준비됨" : "PLAUD API 인증정보 확인 필요 · Registry 등록은 가능"}</span></div>${state.can_manage === false ? "" : '<button type="button" id="pdrAddButton" class="pdr-add-button"><span>＋</span> 기기 등록</button>'}`;
    host.querySelector("#pdrRegisterFormWrap")?.remove(); toolbar.insertAdjacentHTML("afterend", renderForm());
    const body = host.querySelector(".peg-reg-table tbody"); if (body) body.innerHTML = state.items.length ? state.items.map(rowMarkup).join("") : `<tr><td colspan="10"><div class="pdr-empty-note"><strong>등록된 PLAUD 기기가 없습니다.</strong><span>${state.can_manage === false ? "관리자가 기기를 등록하면 표시됩니다." : "오른쪽의 '기기 등록' 버튼을 눌러 실제 기기를 등록해 주세요."}</span></div></td></tr>`;
    const badge = host.querySelector(".peg-reg-badge"); if (badge) badge.textContent = `${state.items.length}대 등록 · ${state.items.filter((item) => item.bind_status === "bound").length}대 Bound`;
    bindUi(host);
  }

  function showFormMessage(message, error = false) { const node = document.querySelector("#pdrFormMessage"); if (!node) return; node.textContent = message; node.className = `pdr-message show${error ? " error" : ""}`; }
  async function loadRegistry(host) { renderRegistry(host); try { state = await api("/api/plaud-devices"); renderRegistry(host); } catch (error) { const body = host.querySelector(".peg-reg-table tbody"); if (body) body.innerHTML = `<tr><td colspan="10"><div class="pdr-empty-note"><strong>기기 Registry API 연결을 확인해 주세요.</strong><span>${escapeHtml(error.message)}</span></div></td></tr>`; } }

  function bindUi(host) {
    host.querySelector("#pdrAddButton")?.addEventListener("click", () => { partnerTouched = false; host.querySelector("#pdrRegisterFormWrap")?.classList.add("open"); host.querySelector("#pdrSerial")?.focus(); });
    host.querySelector("#pdrCancel")?.addEventListener("click", () => host.querySelector("#pdrRegisterFormWrap")?.classList.remove("open"));
    host.querySelector("#pdrAssignedUser")?.addEventListener("change", syncPartnerId); host.querySelector("#pdrPartnerUserId")?.addEventListener("input", () => { partnerTouched = true; });
    host.querySelector("#pdrSerial")?.addEventListener("input", (event) => { const sn = event.target.value.trim(), select = host.querySelector("#pdrDeviceType"); if (!select || select.value) return; if (sn.startsWith("881")) select.value = "notepro"; if (sn.startsWith("882")) select.value = "notepins"; });
    host.querySelector("#pdrSubmit")?.addEventListener("click", async () => { const button = host.querySelector("#pdrSubmit"); const payload = { device_name: host.querySelector("#pdrDeviceName")?.value.trim(), model: host.querySelector("#pdrModel")?.value.trim(), serial_number: host.querySelector("#pdrSerial")?.value.trim(), device_type: host.querySelector("#pdrDeviceType")?.value, assigned_user_id: host.querySelector("#pdrAssignedUser")?.value, partner_user_id: host.querySelector("#pdrPartnerUserId")?.value.trim() }; if (!payload.serial_number || !payload.assigned_user_id) return showFormMessage("Serial Number와 할당 사용자를 입력해 주세요.", true); button.disabled = true; try { await api("/api/plaud-devices", { method: "POST", body: JSON.stringify(payload) }); host.querySelector("#pdrRegisterFormWrap")?.classList.remove("open"); await loadRegistry(host); } catch (error) { showFormMessage(error.message, true); } finally { button.disabled = false; } });
    host.querySelectorAll("[data-pdr-action]").forEach((button) => button.addEventListener("click", async () => { const id = button.dataset.id, action = button.dataset.pdrAction, item = state.items.find((device) => device.id === id); if (!item) return; let endpoint = `/api/plaud-devices/${encodeURIComponent(id)}/${action}`, method = "POST"; if (action === "delete") { endpoint = `/api/plaud-devices/${encodeURIComponent(id)}`; method = "DELETE"; if (!confirm(`'${item.device_name}' 등록정보를 삭제하시겠습니까?\nPLAUD Cloud에 Bound된 기기는 먼저 Unbind해야 합니다.`)) return; } if (action === "bind" && !confirm(`PLAUD Cloud에 이 기기를 바인딩하시겠습니까?\n\n기기: ${item.device_name}\nSN: ${item.serial_number}\n사용자: ${item.assigned_user_name}\nPartner User ID: ${item.partner_user_id}\n\n바인딩 후 Android 앱에서 BLE Bind/Handshake를 완료해야 합니다.`)) return; if (action === "unbind" && !confirm("PLAUD Cloud 바인딩을 해제하시겠습니까?\nAndroid 앱에서도 depair가 필요합니다.")) return; button.disabled = true; try { const result = await api(endpoint, { method }); if (result.message) alert(result.message); await loadRegistry(host); } catch (error) { alert(error.message); } finally { button.disabled = false; } }));
  }

  function attach() { ensureStyle(); if (!isPlaudPage()) return; const host = document.querySelector(ROOT_SELECTOR) || createDirectHost(); if (!host || host.dataset.registryUiAttached === "1") return; host.dataset.registryUiAttached = "1"; loadRegistry(host); }
  ensureStyle(); new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true }); document.addEventListener("DOMContentLoaded", attach); window.addEventListener("load", attach); attach();
})();