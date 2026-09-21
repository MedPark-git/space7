const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));

const connectionLabel = (item) => {
  const labels = {
    master_ready: ["마스터 운영", "master"],
    master_key_required: ["보안키 필요", "attention"],
    registered: ["연결 등록", "prepared"],
    secret_required: ["인증키 필요", "attention"],
    reserved: ["공간 예약", "reserved"],
  };
  return labels[item.connection_status] || ["확인 필요", "attention"];
};

export function ssoMarkup(data) {
  const summary = data.summary;
  const stats = [
    ["전체 공간", summary.total_spaces],
    ["운영 사이트", summary.occupied_spaces],
    ["하위 클라이언트", summary.registered_clients],
    ["연결 준비 완료", summary.configured_clients],
  ];
  return `
    <header class="sso-heading"><div><h2>통합 로그인 마스터</h2><p>MedPark One이 임직원 인증을 담당하고, 각 AI SPACE 사이트는 개별 권한을 유지합니다.</p></div><button type="button" class="button secondary" data-sso-refresh>새로고침</button></header>
    <div class="sso-notice ${summary.master_ready ? "ready" : "warning"}" role="status"><strong>${summary.master_ready ? "중앙 인증 서버 운영 준비 완료" : "중앙 인증 보안키 확인 필요"}</strong><p>${summary.master_ready ? "표준 OIDC 인증 코드 방식과 PKCE가 활성화되었습니다. 하위 사이트는 등록된 콜백 주소로만 연결할 수 있습니다." : "서명키와 요청 보호키를 운영 환경에 등록하면 중앙 인증 서버가 활성화됩니다."}</p></div>
    <div class="sso-summary">${stats.map(([label, value]) => `<div><span>${escape(label)}</span><strong>${escape(value)}<small>개</small></strong></div>`).join("")}</div>
    <div class="sso-policy"><p><strong>인증 기준 주소</strong> <code>${escape(data.issuer)}</code></p><p><strong>적용 대상</strong> AI SPACE 내 모든 운영 공간 · 아마란스 제외</p><p><strong>계정·권한 원칙</strong> 중앙 계정은 <code>iss + sub</code>로 연결하고, 역할과 접근 권한은 각 사이트에서 유지</p><p><strong>공간 목록 확인일</strong> ${escape(data.inventory_checked_on)} · 빈 공간은 client ID를 예약했습니다.</p></div>
    <div class="sso-list-heading"><h3>공간별 연결 등록</h3><a class="button secondary" href="/api/admin/sso/master/export" download>전체 연결 설정 받기</a></div>
    <div class="sso-table-wrap"><table class="data-table sso-table"><caption class="sso-sr-only">AI SPACE 공간별 중앙 인증 연결 등록 현황</caption><thead><tr><th scope="col">공간</th><th scope="col">사이트</th><th scope="col">구분</th><th scope="col">상태</th><th scope="col">연결 설정</th></tr></thead><tbody>${data.spaces.map((item) => {
      const [label, className] = connectionLabel(item);
      const type = item.kind === "portal" ? "SSO 마스터" : item.application_type === "browser" ? "브라우저 클라이언트" : item.project_id ? "서버 클라이언트" : "미사용 공간";
      return `<tr><td><strong>${escape(item.space_label)}</strong>${item.kind === "portal" ? '<small>중앙 인증</small>' : ""}</td>
      <td><strong>${escape(item.display_name)}</strong><small class="sso-site-url">${escape(item.public_url || "사이트 생성 후 주소 등록")}</small></td>
      <td>${escape(type)}</td>
      <td><span class="sso-badge ${className}">${escape(label)}</span>${item.deployment_status === "failed" ? '<small class="sso-deploy-warning">사이트 배포 상태 확인 필요</small>' : ""}</td>
      <td>${item.kind === "application" && item.project_id ? `<a class="sso-download" href="/api/admin/sso/master/clients/${encodeURIComponent(item.client_id)}/config" download>설정 받기</a>` : '<span class="sso-muted">—</span>'}</td></tr>`;
    }).join("")}</tbody></table></div>
    <p class="sso-footnote">내려받는 설정에는 인증키가 포함되지 않습니다. 각 하위 사이트는 관리자 확인을 거친 기존 계정에 중앙 식별자를 연결한 뒤 로그인 전환을 완료합니다.</p>`;
}

export async function renderSSOMaster(host) {
  host.innerHTML = '<section class="sso-preparation" data-sso-root aria-label="SSO 설정"><p role="status">통합 로그인 상태를 불러오는 중입니다.</p></section>';
  const root = host.querySelector("[data-sso-root]");
  try {
    const response = await fetch("/api/admin/sso/master", { credentials: "same-origin", headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "통합 로그인 상태를 불러오지 못했습니다.");
    if (host.querySelector("[data-sso-root]") !== root) return;
    root.innerHTML = ssoMarkup(data);
    root.querySelector("[data-sso-refresh]").addEventListener("click", () => renderSSOMaster(host));
  } catch (error) {
    if (host.querySelector("[data-sso-root]") !== root) return;
    root.innerHTML = `<p class="form-error" role="alert">${escape(error.message || "통합 로그인 상태를 불러오지 못했습니다.")}</p><button type="button" class="button secondary" data-sso-retry>다시 불러오기</button>`;
    root.querySelector("[data-sso-retry]").addEventListener("click", () => renderSSOMaster(host));
  }
}
