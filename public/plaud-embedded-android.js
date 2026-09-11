(() => {
  const PANEL_ID = "plaudEmbeddedAndroidGuide";
  const STYLE_ID = "plaudEmbeddedAndroidGuideStyle";
  const ANDROID_DOCS = "https://docs.plaud.ai/plaud-embedded/android-sdk";
  const STARTER_DOCS = "https://docs.plaud.ai/plaud-embedded/android-starter-app";
  const DEV_PORTAL = "https://dev.plaud.ai";
  const DOCS_HOME = "https://docs.plaud.ai";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .plaud-embedded-guide{position:relative;overflow:hidden;margin:0 0 18px;padding:22px;border:1px solid #cfe3dc;border-radius:18px;background:linear-gradient(135deg,#f7fcfa 0%,#eef8f4 52%,#f8fbff 100%);box-shadow:0 16px 40px rgba(7,84,72,.08)}
      .plaud-embedded-guide::before{content:"";position:absolute;right:-70px;top:-90px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(10,155,126,.17),rgba(10,155,126,0) 70%);pointer-events:none}
      .peg-head{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}
      .peg-kicker{display:inline-flex;align-items:center;gap:7px;color:#087563;font-size:9px;font-weight:900;letter-spacing:1.3px}.peg-kicker::before{content:"";width:7px;height:7px;border-radius:50%;background:#10a87d;box-shadow:0 0 0 4px #d9f3e9}
      .peg-head h2{margin:7px 0 5px;color:#123d34;font-size:21px;letter-spacing:-.8px}.peg-head p{max-width:760px;margin:0;color:#687a75;font-size:10px;line-height:1.65}
      .peg-status{flex:none;display:grid;gap:5px;min-width:160px;padding:12px 14px;border:1px solid #c9e4da;border-radius:13px;background:rgba(255,255,255,.84);box-shadow:0 8px 20px rgba(8,108,91,.06)}
      .peg-status span{color:#7a8a85;font-size:8px}.peg-status b{color:#086c5b;font-size:11px}.peg-status small{color:#9a6b1b;font-size:8px;font-weight:800}
      .peg-flow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:14px}
      .peg-flow-card{position:relative;min-height:108px;padding:14px;border:1px solid #dbe8e3;border-radius:13px;background:#fff;box-shadow:0 7px 18px rgba(16,75,62,.045)}
      .peg-flow-card:not(:last-child)::after{content:"→";position:absolute;right:-10px;top:42%;z-index:3;width:20px;height:20px;display:grid;place-items:center;border:1px solid #d0e5dd;border-radius:50%;background:#f3faf7;color:#0a8b71;font-size:10px;font-weight:900}
      .peg-flow-card em{display:grid;place-items:center;width:30px;height:30px;margin-bottom:9px;border-radius:9px;background:#e8f6f1;color:#087563;font-style:normal;font-size:14px;font-weight:900}.peg-flow-card b{display:block;color:#29453e;font-size:10px}.peg-flow-card span{display:block;margin-top:5px;color:#7b8b87;font-size:8px;line-height:1.55}
      .peg-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:14px 0}
      .peg-fact{padding:13px;border:1px solid #dde9e5;border-radius:12px;background:rgba(255,255,255,.82)}.peg-fact strong{display:flex;align-items:center;gap:7px;color:#23473e;font-size:10px}.peg-fact strong i{width:22px;height:22px;display:grid;place-items:center;border-radius:7px;background:#edf8f4;color:#08846d;font-style:normal;font-size:10px}.peg-fact p{margin:7px 0 0;color:#758580;font-size:8px;line-height:1.6}.peg-fact.warn{border-color:#eadcb6;background:#fffaf0}.peg-fact.warn strong i{background:#fff0c9;color:#8b651d}
      .peg-columns{display:grid;grid-template-columns:1.15fr .85fr;gap:10px;margin-top:10px}.peg-box{padding:15px;border:1px solid #dde8e5;border-radius:13px;background:#fff}.peg-box h3{margin:0 0 10px;color:#23443c;font-size:11px}.peg-checks{display:grid;grid-template-columns:1fr 1fr;gap:7px}.peg-check{display:flex;gap:8px;align-items:flex-start;padding:8px;border-radius:9px;background:#f8fbfa}.peg-check b{flex:none;width:19px;height:19px;display:grid;place-items:center;border-radius:6px;background:#e7f5ef;color:#08735f;font-size:8px}.peg-check span{color:#596b66;font-size:8px;line-height:1.5}.peg-note{padding:11px 12px;border-radius:10px;background:#f2f6ff;color:#52637a;font-size:8px;line-height:1.65}.peg-note b{display:block;margin-bottom:4px;color:#35527b;font-size:9px}.peg-id-example{margin-top:8px;padding:9px 10px;border:1px dashed #bfd8cf;border-radius:9px;background:#f8fcfa;color:#526761;font:8px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
      .peg-links{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.peg-links a{display:inline-flex;align-items:center;gap:6px;padding:8px 10px;border:1px solid #cfe1db;border-radius:9px;background:#fff;color:#08715e;font-size:8px;font-weight:850;transition:.16s ease}.peg-links a:hover{transform:translateY(-1px);border-color:#8dcbbb;box-shadow:0 7px 15px rgba(7,84,72,.08)}
      .peg-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:13px;padding-top:12px;border-top:1px solid #dce9e4;color:#788681;font-size:8px}.peg-footer b{color:#3c5c53}
      @media(max-width:1050px){.peg-flow,.peg-facts{grid-template-columns:1fr 1fr}.peg-flow-card:nth-child(2)::after{display:none}.peg-columns{grid-template-columns:1fr}}
      @media(max-width:680px){.plaud-embedded-guide{padding:16px}.peg-head{display:grid}.peg-status{min-width:0}.peg-flow,.peg-facts,.peg-checks{grid-template-columns:1fr}.peg-flow-card::after{display:none}.peg-footer{align-items:flex-start;flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function isPlaudPage(root) {
    const title = root.querySelector(".plaud-page-heading h1, .page-heading h1");
    return Boolean(title && /회의록[_\s-]*Plaud/i.test(title.textContent || ""));
  }

  function createPanel() {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "plaud-embedded-guide";
    panel.innerHTML = `
      <div class="peg-head">
        <div>
          <span class="peg-kicker">PLAUD EMBEDDED · ANDROID DEVICE CONNECTION</span>
          <h2>Android Embedded SDK 기반 기기 연결 구조</h2>
          <p>PLAUD 업체 개발자 답변과 최신 공식 개발문서를 기준으로 정리했습니다. 현재 PLAUD 하드웨어를 MedPark 앱에서 사용하려면 <b>Android Embedded SDK를 통한 페어링/바인딩이 필수</b>이며, 웹 포털에서 BLE 페어링을 직접 수행하는 구조는 아닙니다.</p>
        </div>
        <div class="peg-status"><span>현재 연동 기준</span><b>Android Native + Embedded SDK</b><small>기기 페어링 필수</small></div>
      </div>

      <div class="peg-flow">
        <article class="peg-flow-card"><em>1</em><b>MedPark Android App</b><span>사용자 로그인 · PLAUD 연결 화면 · Android 권한 처리</span></article>
        <article class="peg-flow-card"><em>2</em><b>PLAUD Embedded SDK</b><span>User Token 초기화 · BLE Scan · Bind / Unbind · 파일 동기화</span></article>
        <article class="peg-flow-card"><em>3</em><b>PLAUD Device</b><span>Note Pro / NotePin 계열 · 한 번에 하나의 모바일 앱에만 바인딩</span></article>
        <article class="peg-flow-card"><em>4</em><b>MedPark / PLAUD Backend</b><span>Partner/User Token · 바인딩 상태 · 오디오 업로드 · 전사 API 처리</span></article>
      </div>

      <div class="peg-facts">
        <article class="peg-fact"><strong><i>✓</i>기기 페어링 필수</strong><p>현재는 PLAUD 기기를 Embedded SDK로 직접 연결해야 합니다. 기기 연결 없이 MedPark 앱이 PLAUD 하드웨어를 바로 사용하는 방식은 지원되지 않습니다.</p></article>
        <article class="peg-fact warn"><strong><i>!</i>한 기기 = 한 앱</strong><p>동일 기기를 MedPark 앱과 PLAUD 기본 앱에 동시에 바인딩할 수 없습니다. 다른 앱으로 전환하려면 기존 바인딩을 해제해야 합니다.</p></article>
        <article class="peg-fact"><strong><i>ID</i>Partner User ID</strong><p>6자 이상의 임의 문자열 사용이 가능합니다. 멀티유저 구조를 위해 사용자별로 안정적으로 유지되는 내부 식별자를 사용하는 방식이 적합합니다.</p></article>
        <article class="peg-fact"><strong><i>🔒</i>암호화 / 소유권 잠금</strong><p>User Token을 기반으로 키가 생성되고 기기에 ownership lock이 적용됩니다. 유효한 사용자 토큰을 가진 해당 앱에서만 파일을 복호화할 수 있는 구조입니다.</p></article>
      </div>

      <div class="peg-columns">
        <section class="peg-box">
          <h3>MedPark Android 구현 체크리스트</h3>
          <div class="peg-checks">
            <div class="peg-check"><b>01</b><span><strong>SDK 적용</strong><br>Android 앱에 PLAUD Embedded SDK(.aar) 추가</span></div>
            <div class="peg-check"><b>02</b><span><strong>User Token 초기화</strong><br>앱 Context + User Token + regional domain으로 SDK 초기화</span></div>
            <div class="peg-check"><b>03</b><span><strong>Android 권한</strong><br>Bluetooth Scan/Connect 및 필요한 위치 권한 처리</span></div>
            <div class="peg-check"><b>04</b><span><strong>BLE Scan</strong><br>주변 PLAUD 기기 검색 후 대상 기기 선택</span></div>
            <div class="peg-check"><b>05</b><span><strong>Cloud Bind</strong><br>기기 SN과 Device Type을 User Token으로 PLAUD에 등록</span></div>
            <div class="peg-check"><b>06</b><span><strong>BLE Bind / Handshake</strong><br>기기 내부 키 생성 및 보안 핸드셰이크 완료</span></div>
            <div class="peg-check"><b>07</b><span><strong>File Sync</strong><br>기기 녹음 파일을 Android 앱으로 동기화</span></div>
            <div class="peg-check"><b>08</b><span><strong>Transcription</strong><br>오디오 업로드 후 전사 API 결과를 회의록 시스템으로 연결</span></div>
          </div>
        </section>

        <section class="peg-box">
          <h3>MedPark 권장 역할 분리</h3>
          <div class="peg-note"><b>MedPark One · Web</b>기기 연결 상태, 연동 안내, 회의록/전사 결과 조회 및 관리용. 실제 Bluetooth 페어링은 수행하지 않음.</div>
          <div class="peg-note" style="margin-top:7px"><b>MedPark Android App</b>PLAUD SDK 초기화, BLE 검색, 기기 Bind/Unbind, 파일 동기화 등 실제 하드웨어 제어 담당.</div>
          <div class="peg-note" style="margin-top:7px"><b>MedPark Backend</b>Partner Token → User Token 발급/관리, 사용자별 식별자와 바인딩 상태 관리, 전사 결과 연결 담당.</div>
          <div class="peg-id-example">Partner User ID 권장 예시<br>MPK-7f31a9c2 / MPK-user-000123<br><span style="font-family:inherit;color:#81908b">※ 6자 이상, 사용자마다 고정된 비민감 내부 ID 권장</span></div>
        </section>
      </div>

      <div class="peg-links">
        <a href="${ANDROID_DOCS}" target="_blank" rel="noopener noreferrer">Android SDK 문서 ↗</a>
        <a href="${STARTER_DOCS}" target="_blank" rel="noopener noreferrer">Android Starter App ↗</a>
        <a href="${DEV_PORTAL}" target="_blank" rel="noopener noreferrer">PLAUD Developer ↗</a>
        <a href="${DOCS_HOME}" target="_blank" rel="noopener noreferrer">전체 개발문서 ↗</a>
      </div>

      <div class="peg-footer"><span><b>업체 답변 반영:</b> Pairing 필수 · 단일 앱 바인딩 · Partner User ID 6자 이상 · User Token 기반 암호화</span><span>현재 공식문서에는 별도 Transcription API도 제공되지만, 하드웨어 바인딩 요건을 대체하지는 않습니다.</span></div>
    `;
    return panel;
  }

  function ensurePanel() {
    const root = document.getElementById("pageContent");
    if (!root || !isPlaudPage(root)) return;
    if (root.querySelector(`#${PANEL_ID}`)) return;
    const heading = root.querySelector(".plaud-page-heading, .page-heading");
    if (!heading) return;
    heading.insertAdjacentElement("afterend", createPanel());
  }

  ensureStyle();
  const root = document.getElementById("pageContent");
  if (root) {
    new MutationObserver(() => ensurePanel()).observe(root, { childList: true, subtree: true });
  }
  document.addEventListener("DOMContentLoaded", ensurePanel);
  window.addEventListener("load", ensurePanel);
  ensurePanel();
})();
