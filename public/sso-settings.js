const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));

export function ssoMarkup(data) {
  const summary = data.summary;
  const stats = [["전체 공간", summary.total_spaces], ["사이트 등록", summary.occupied_spaces], ["신규 사이트 예약", summary.reserved_spaces], ["SSO 사용 중", summary.active_sso_sites]];
  return `
    <header class="sso-heading"><div><h2>통합 로그인 연결 준비</h2><p>MedPark One을 시작점으로 AI SPACE 업무 사이트를 연결합니다.</p></div><button type="button" class="button secondary" data-sso-refresh>새로고침</button></header>
    <div class="sso-notice" role="status"><strong>사전 설정 완료 · 통합 로그인 적용 전</strong><p>전체 공간의 연결 정보를 준비했습니다. 각 사이트의 로그인 연동과 계정 연결을 검증한 후 사용할 수 있습니다. 현재는 기존 로그인 방식을 사용합니다.</p></div>
    <div class="sso-summary">${stats.map(([label, value]) => `<div><span>${escape(label)}</span><strong>${escape(value)}<small>개</small></strong></div>`).join("")}</div>
    <div class="sso-policy"><p><strong>적용 대상</strong> AI SPACE 내 모든 공간 · 아마란스 제외</p><p><strong>계정 연결</strong> 관리자가 확인한 임직원 계정과 연결 · 사이트별 기존 권한과 작성 이력 유지</p><p><strong>공간 목록 확인일</strong> ${escape(data.inventory_checked_on)} · 이후 생성·이전한 사이트는 주소를 다시 확인해 등록합니다.</p></div>
    <div class="sso-list-heading"><h3>공간별 준비 현황</h3><a class="button secondary" href="/api/admin/sso/preparation/export" download>전체 연결 설정 받기</a></div>
    <div class="sso-table-wrap"><table class="data-table sso-table"><caption class="sso-sr-only">AI SPACE 전체 공간의 SSO 사전 설정 및 연결 준비 현황</caption><thead><tr><th scope="col">공간</th><th scope="col">사이트</th><th scope="col">현재 로그인</th><th scope="col">준비 상태</th><th scope="col">연결 설정</th></tr></thead><tbody>${data.spaces.map((item) => `
      <tr><td><strong>${escape(item.space_label)}</strong>${item.kind === "portal" ? '<small>통합 포털</small>' : ""}</td>
      <td><strong>${escape(item.display_name)}</strong><small class="sso-site-url">${escape(item.public_url || "사이트 생성 후 주소 등록")}</small></td>
      <td>${escape(item.auth_label)}</td>
      <td><span class="sso-badge ${item.project_id ? "prepared" : "reserved"}">${item.project_id ? "연결 정보 준비" : "공간 예약"}</span><details><summary>남은 작업</summary><ul>${item.remaining_tasks.map((task) => `<li>${escape(task)}</li>`).join("")}</ul></details></td>
      <td>${item.project_id ? `<a class="sso-download" href="/api/admin/sso/preparation/clients/${encodeURIComponent(item.client_id)}/config" download>설정 받기</a>` : '<span class="sso-muted">주소 등록 후 제공</span>'}</td></tr>`).join("")}</tbody></table></div>
    <p class="sso-footnote">설정 파일에는 비밀번호나 인증키가 포함되지 않습니다. 파일을 내려받는 것만으로 통합 로그인이 활성화되지는 않습니다.</p>`;
}

export async function renderSSOPreparation(host) {
  host.innerHTML = '<section class="sso-preparation" data-sso-root aria-label="SSO 설정"><p role="status">공간별 SSO 준비 현황을 불러오는 중입니다.</p></section>';
  const root = host.querySelector("[data-sso-root]");
  try {
    const response = await fetch("/api/admin/sso/preparation", { credentials: "same-origin", headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "SSO 설정을 불러오지 못했습니다.");
    if (host.querySelector("[data-sso-root]") !== root) return;
    root.innerHTML = ssoMarkup(data);
    root.querySelector("[data-sso-refresh]").addEventListener("click", () => renderSSOPreparation(host));
  } catch (error) {
    if (host.querySelector("[data-sso-root]") !== root) return;
    root.innerHTML = `<p class="form-error" role="alert">${escape(error.message || "SSO 설정을 불러오지 못했습니다.")}</p><button type="button" class="button secondary" data-sso-retry>다시 불러오기</button>`;
    root.querySelector("[data-sso-retry]").addEventListener("click", () => renderSSOPreparation(host));
  }
}
