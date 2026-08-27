const { useState, useEffect, useMemo, useRef, useCallback } = React;

/* ══════════════════ 유틸 ══════════════════ */

const won = (n) => (Number(n) || 0).toLocaleString("ko-KR");
const amountNumber = (value) => Number(String(value || "").replace(/[^0-9]/g, "")) || 0;
const formatAmountInput = (value) => {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  return digits ? Number(digits).toLocaleString("ko-KR") : "";
};
function koreanAmountUnit(value) {
  let amount = amountNumber(value);
  if (!amount) return "";
  const parts = [];
  const eok = Math.floor(amount / 100000000);
  if (eok) { parts.push(won(eok) + "억"); amount %= 100000000; }
  const man = Math.floor(amount / 10000);
  if (man) { parts.push(won(man) + "만"); amount %= 10000; }
  if (amount) parts.push(won(amount));
  return parts.join(" ") + "원";
}

function short(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e8) return { value: (v / 1e8).toFixed(1), unit: "억" };
  if (Math.abs(v) >= 1e4) return { value: Math.round(v / 1e4).toLocaleString("ko-KR"), unit: "만" };
  return { value: v.toLocaleString("ko-KR"), unit: "원" };
}

const STATUS_STYLE = { 정상: "ok", 연체: "warn", 부실: "bad" };
const STATUS_LABEL = { 정상: "정상채권", 연체: "미수채권", 부실: "부실채권" };
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);
const sum = (list, key) => list.reduce((a, x) => a + (Number(x[key]) || 0), 0);
function customerForUnit(customer, unit) {
  if (unit === "전체") return customer;
  const part = customer.unit_breakdown && customer.unit_breakdown[unit];
  if (!part) return null;
  return {
    ...customer, ...part, biz_unit: unit,
    status: Number(part.bad_balance) ? "부실" : Number(part.overdue_balance) ? "연체" : "정상",
  };
}
function customersForUnit(customers, unit) {
  return unit === "전체" ? customers : customers.map((c) => customerForUnit(c, unit)).filter(Boolean);
}
const code5 = (code) => String(code || "").padStart(5, "0");
const overdueMonths = (days) => Math.ceil(Math.max(0, Number(days) || 0) / 30);

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
  if (!res.ok) throw new Error(data.error || "요청을 처리하지 못했습니다. (" + res.status + ")");
  return data;
}

/* ══════════════════ 공용 컴포넌트 ══════════════════ */

function Card({ title, actions, children, flush }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card__head">
          <h3>{title}</h3>
          <div className="spacer" />
          {actions}
        </header>
      )}
      <div className={"card__body" + (flush ? " card__body--flush" : "")}>{children}</div>
    </section>
  );
}

function Empty({ title, children }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}

function Badge({ status }) {
  return <span className={"badge badge--" + (STATUS_STYLE[status] || "mute")}>{STATUS_LABEL[status] || status}</span>;
}

function Field({ label, children }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

/* ══════════════════ 로그인 ══════════════════ */

function Login({ onDone }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const usernameRef = React.useRef(null);
  const passwordRef = React.useRef(null);

  async function submit() {
    const loginUsername = (usernameRef.current?.value || username).trim();
    const loginPassword = passwordRef.current?.value || password;
    if (!loginUsername || !loginPassword) {
      setError("아이디와 비밀번호를 모두 입력해 주세요.");
      return;
    }
    setBusy(true); setError("");
    try {
      const { user } = await api("/tf/ar/api/login", { method: "POST", body: { username: loginUsername, password: loginPassword } });
      onDone(user);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <div className="login">
      <aside className="login__aside">
        <div className="login__brand">MEDPARK</div>
        <div>
          <h1 className="login__head">미수채권<br />관리 시스템</h1>
          <p className="login__sub">
            덴탈·메디컬·에스테틱 세 사업부의 채권 잔액과 수금 진행을 한 화면에서 봅니다.
          </p>
          <div className="login__stat">
            <div><b>3</b>사업부</div>
            <div><b>9</b>채권 분류</div>
            <div><b>11</b>권한 구분</div>
          </div>
        </div>
        <div className="login__brand" style={{ opacity: .55 }}>내부 업무용 · 외부 공유 금지</div>
      </aside>

      <div className="login__panel">
        <div className="login__form">
          <h2>로그인</h2>
          <p className="hint">회사에서 발급받은 계정으로 접속하세요.</p>
          {error && <div className="alert alert--bad">{error}</div>}
          <Field label="아이디">
            <input ref={usernameRef} className="input" value={username} autoFocus autoComplete="username"
              onChange={(e) => setUsername(e.target.value)} onInput={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Medpark0" />
          </Field>
          <Field label="비밀번호">
            <input ref={passwordRef} className="input" type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} onInput={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </Field>
          <button className="btn btn--primary" style={{ width: "100%", marginTop: 6 }}
            onClick={submit} disabled={busy}>
            {busy ? "확인하는 중" : "로그인"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════ 대시보드 ══════════════════ */

function Dashboard({ data, setScreen, setPreset }) {
  const { collections, targets } = data;
  const customers = data.customers;
  const [unit, setUnit] = useState("전체");
  const [normalTopUnit, setNormalTopUnit] = useState("전체");
  const [overdueTopUnit, setOverdueTopUnit] = useState("전체");

  const scoped = useMemo(
    () => customersForUnit(customers, unit),
    [customers, unit]);

  const totals = useMemo(() => {
    const by = { 정상: sum(scoped, "normal_balance"), 연체: sum(scoped, "overdue_balance"), 부실: sum(scoped, "bad_balance") };
    const cnt = {
      정상: scoped.filter((c) => c.normal_balance !== 0).length,
      연체: scoped.filter((c) => c.overdue_balance !== 0).length,
      부실: scoped.filter((c) => c.bad_balance !== 0).length,
    };
    return { by, cnt, all: sum(scoped, "balance") };
  }, [scoped]);

  const byUnit = useMemo(() => data.meta.units.map((u) => {
    const rows = customersForUnit(customers, u);
    const g = { unit: u, 정상: 0, 연체: 0, 부실: 0, count: rows.length };
    rows.forEach((c) => {
      g.정상 += Number(c.normal_balance) || 0;
      g.연체 += Number(c.overdue_balance) || 0;
      g.부실 += Number(c.bad_balance) || 0;
    });
    g.total = g.정상 + g.연체 + g.부실;
    return g;
  }), [customers, data.meta.units]);

  const approved = collections.filter((c) => c.state === "approved");
  const monthly = useMemo(() => {
    const map = {};
    approved.forEach((c) => {
      const m = (c.paid_at || "").slice(0, 7);
      if (!m) return;
      map[m] = map[m] || { month: m, amount: 0, count: 0 };
      map[m].amount += c.amount; map[m].count += 1;
    });
    return Object.values(map).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 6);
  }, [approved]);

  const normalTop5 = customersForUnit(customers, normalTopUnit)
    .filter((c) => c.normal_balance > 0)
    .sort((a, b) => b.normal_balance - a.normal_balance).slice(0, 5);
  const overdueTop5 = customersForUnit(customers, overdueTopUnit)
    .filter((c) => c.overdue_balance > 0)
    .sort((a, b) => b.overdue_balance - a.overdue_balance).slice(0, 5);
  const topUnitSelect = (value, setter, label) => (
    <select className="select" style={{ width: 110, padding: "6px 9px" }}
      value={value} onChange={(e) => setter(e.target.value)} aria-label={label}>
      {["전체", ...data.meta.units].map((u) => <option key={u} value={u}>{u}</option>)}
    </select>
  );

  const todayStr = today();
  const weekEnd = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const openTargets = targets.filter((t) => t.state !== "done");
  const dueToday = openTargets.filter((t) => t.target_date === todayStr);
  const dueWeek = openTargets.filter((t) => t.target_date > todayStr && t.target_date <= weekEnd);
  const overdueTargets = openTargets.filter((t) => t.target_date < todayStr);

  const owners = useMemo(() => {
    const map = {};
    scoped.forEach((c) => {
      const key = c.owner || "미지정";
      map[key] = map[key] || { owner: key, 정상: 0, 연체: 0, 부실: 0, total: 0, count: 0 };
      map[key].정상 += c.normal_balance; map[key].연체 += c.overdue_balance;
      map[key].부실 += c.bad_balance; map[key].total += c.balance; map[key].count += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [scoped]);

  const jump = (status) => { setPreset({ status, unit }); setScreen("customers"); };
  const maxUnit = Math.max(1, ...byUnit.map((g) => g.total));

  const kpis = [
    { key: "전체", label: "전체 채권 잔액", value: totals.all, count: scoped.length, color: "var(--brand)" },
    { key: "정상", label: "정상채권 잔액", value: totals.by.정상, count: totals.cnt.정상, color: "var(--ok)" },
    { key: "연체", label: "미수채권(11개월 내) 잔액", value: totals.by.연체, count: totals.cnt.연체, color: "var(--warn)" },
    { key: "부실", label: "부실채권(12개월 이상)", value: totals.by.부실, count: totals.cnt.부실, color: "var(--bad)" },
  ];
  // 정오 UTC를 기준으로 계산하면 한국 브라우저에서도 날짜가 하루 더 밀리지 않는다.
  const yesterdayDate = new Date(data.meta.today + "T12:00:00Z");
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  const customerUnit = Object.fromEntries(customers.map((c) => [c.code, c.biz_unit]));
  const yesterdayCollections = approved.filter((c) => c.paid_at === yesterday);
  const yesterdayCustomers = Object.values(yesterdayCollections.reduce((map, c) => {
    const key = c.customer_code || c.customer_name;
    if (!map[key]) map[key] = { name: c.customer_name || key, amount: 0 };
    map[key].amount += Number(c.amount) || 0;
    return map;
  }, {})).sort((a, b) => b.amount - a.amount);
  const yesterdayByUnit = data.meta.units.map((u) => ({
    unit: u,
    amount: sum(yesterdayCollections.filter((c) => customerUnit[c.customer_code] === u), "amount"),
  }));

  return (
    <>
      <div className="chiprow">
        {["전체", ...data.meta.units].map((u) => (
          <button key={u} className="chip" aria-pressed={unit === u} onClick={() => setUnit(u)}>{u}</button>
        ))}
      </div>

      <div className="grid grid--kpi">
        {kpis.map((k) => {
          const s = short(k.value);
          return (
            <button key={k.key} className="kpi" onClick={() => k.key !== "전체" && jump(k.key)}>
              <div className="kpi__label">
                <i className="kpi__dot" style={{ background: k.color }} />{k.label}
              </div>
              <div className="kpi__value num">{s.value}<em>{s.unit}</em></div>
              <div className="kpi__meta num">
                거래처 {k.count}곳 · {won(k.value)}원
              </div>
            </button>
          );
        })}
      </div>

      <Card title={"전일 수금현황 요약 · " + yesterday}>
        <div className="grid grid--3">
          <div><div className="kpi__label">승인 수금 합계</div>
            <div className="kpi__value num">{won(sum(yesterdayCollections, "amount"))}<em>원</em></div></div>
          <div><div className="kpi__label">승인 건수</div>
            <div className="kpi__value num">{yesterdayCollections.length}<em>건</em></div>
            <div className="t-sm t-muted" style={{ marginTop: 4 }}>
              {yesterdayCustomers.length ? <>
                {yesterdayCustomers.slice(0, 3).map((c) => c.name).join(" · ")}
                {yesterdayCustomers.length > 3 ? " 외 " + (yesterdayCustomers.length - 3) + "개처" : ""}
              </> : "수금 내역 없음"}
            </div></div>
          <div><div className="kpi__label">사업부별 수금</div>
            <div className="t-sm">{yesterdayByUnit.map((r) =>
              <span key={r.unit} style={{ display: "block", marginTop: 3 }}>{r.unit} · <b className="num">{won(r.amount)}원</b></span>)}</div></div>
        </div>
      </Card>

      <div className="grid grid--2">
        <Card title="사업부별 채권 분류 현황"
          actions={<div className="legend">
            <span><i style={{ background: "var(--ok)" }} />정상채권</span>
            <span><i style={{ background: "var(--warn)" }} />미수채권</span>
            <span><i style={{ background: "var(--bad)" }} />부실채권</span>
          </div>}>
          <div className="signal">
            {byUnit.map((g) => (
              <div className="signal__row" key={g.unit}>
                <div className="signal__unit">{g.unit}</div>
                <div className="signal__bar" style={{ width: (Math.max(8, (g.total / maxUnit) * 100)) + "%" }}>
                  {["정상", "연체", "부실"].map((s) => g[s] > 0 && (
                    <button key={s} className={"signal__seg signal__seg--" + STATUS_STYLE[s]}
                      style={{ width: (g[s] / g.total) * 100 + "%" }}
                      title={g.unit + " " + STATUS_LABEL[s] + " " + won(g[s]) + "원"}
                      onClick={() => { setPreset({ status: s, unit: g.unit }); setScreen("customers"); }} />
                  ))}
                </div>
                <div className="signal__total num">{short(g.total).value}{short(g.total).unit}</div>
              </div>
            ))}
          </div>
          <p className="t-sm t-muted" style={{ margin: "14px 0 0" }}>
            막대를 누르면 해당 사업부·분류의 거래처 목록으로 이동합니다.
          </p>
        </Card>

        <Card title="월별 수금 실적" flush>
          {monthly.length === 0 ? (
            <Empty title="승인된 수금 내역이 아직 없습니다.">
              수금 등록 화면에서 입력하고 재무담당이 승인하면 여기에 집계됩니다.
            </Empty>
          ) : (
            <div className="tablewrap">
              <table>
                <thead><tr><th>기준월</th><th className="r">건수</th><th className="r">수금액 (원)</th></tr></thead>
                <tbody>
                  {monthly.map((m) => (
                    <tr key={m.month}>
                      <td className="t-strong num">{m.month}</td>
                      <td className="r num">{m.count}</td>
                      <td className="r num t-strong">{won(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>합계</td>
                    <td className="r num">{sum(monthly, "count")}</td>
                    <td className="r num">{won(sum(monthly, "amount"))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid--3">
        <Card title="수금목표 요약">
          <table>
            <thead>
              <tr><th>구분</th><th className="r">건수</th><th className="r">목표금액 (원)</th></tr>
            </thead>
            <tbody>
              <tr><td>오늘 목표</td><td className="r num t-strong">{dueToday.length}</td>
                <td className="r num">{won(sum(dueToday, "amount"))}</td></tr>
              <tr><td>이번 주 목표</td><td className="r num t-strong">{dueWeek.length}</td>
                <td className="r num">{won(sum(dueWeek, "amount"))}</td></tr>
              <tr><td>기한 초과</td>
                <td className="r num t-strong" style={{ color: overdueTargets.length ? "var(--bad)" : "inherit" }}>
                  {overdueTargets.length}</td>
                <td className="r num">{won(sum(overdueTargets, "amount"))}</td></tr>
            </tbody>
          </table>
          <button className="btn btn--sm" style={{ marginTop: 12 }} onClick={() => setScreen("targets")}>
            수금목표 관리로 이동
          </button>
        </Card>

        <Card title="정상채권 TOP 5" actions={topUnitSelect(normalTopUnit, setNormalTopUnit, "정상채권 사업부 선택")} flush>
          <div className="tablewrap">
            <table>
              <tbody>
                {normalTop5.map((c, i) => (
                  <tr key={c.code}>
                    <td className="t-muted num" style={{ width: 26 }}>{i + 1}</td>
                    <td className="t-strong">{c.name}</td>
                    <td><Badge status="정상" /></td>
                    <td className="r num">{won(c.normal_balance)}</td>
                  </tr>
                ))}
                {normalTop5.length === 0 && <tr><td className="t-muted">정상채권 데이터가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="미수채권 TOP 5" actions={topUnitSelect(overdueTopUnit, setOverdueTopUnit, "미수채권 사업부 선택")} flush>
          <div className="tablewrap">
            <table>
              <tbody>
                {overdueTop5.map((c, i) => (
                  <tr key={c.code}>
                    <td className="t-muted num" style={{ width: 26 }}>{i + 1}</td>
                    <td className="t-strong">{c.name}</td>
                    <td className="num t-sm t-muted">{overdueMonths(c.overdue_days)}개월</td>
                    <td className="r num">{won(c.overdue_balance)}</td>
                  </tr>
                ))}
                {overdueTop5.length === 0 && (
                  <tr><td className="t-muted">미수채권 데이터가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="담당자별 채권 현황" flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>담당자</th><th className="r">거래처</th><th className="r">정상채권</th>
                <th className="r">미수채권</th><th className="r">부실채권</th><th className="r">합계</th>
                <th style={{ width: 150 }}>미수·부실채권 비중</th>
              </tr>
            </thead>
            <tbody>
              {owners.map((o) => {
                const risk = o.total ? ((o.연체 + o.부실) / o.total) * 100 : 0;
                return (
                  <tr key={o.owner}>
                    <td className="t-strong">{o.owner}</td>
                    <td className="r num">{o.count}</td>
                    <td className="r num">{won(o.정상)}</td>
                    <td className="r num">{won(o.연체)}</td>
                    <td className="r num">{won(o.부실)}</td>
                    <td className="r num t-strong">{won(o.total)}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="bar"><i style={{
                          width: risk + "%",
                          background: risk > 40 ? "var(--bad)" : risk > 15 ? "var(--warn)" : "var(--ok)"
                        }} /></div>
                        <span className="t-sm num t-muted">{risk.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* ══════════════════ 채권요약현황 ══════════════════ */

function BondSummary({ data, notify }) {
  const reportRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const unitNames = { 덴탈: "국내덴탈", 메디컬: "국내메디컬", 에스테틱: "국내에스테틱" };
  const units = data.meta.units;

  function liveNormal(c) {
    const source = {
      later: Number(c.normal_later_balance) || 0,
      next: Number(c.normal_next_balance) || 0,
      current: Number(c.normal_current_balance) || 0,
    };
    let paid = Math.max(0, source.later + source.next + source.current - (Number(c.normal_balance) || 0));
    const current = Math.max(0, source.current - paid); paid = Math.max(0, paid - source.current);
    const next = Math.max(0, source.next - paid); paid = Math.max(0, paid - source.next);
    const later = Math.max(0, source.later - paid);
    return { later, next, current };
  }

  const summary = useMemo(() => units.map((unit) => {
    const customers = customersForUnit(data.customers, unit);
    const row = { unit, later: 0, next: 0, current: 0, overdue: 0, bad: 0,
      normalCollected: 0, overdueCollected: 0 };
    customers.forEach((c) => {
      const live = liveNormal(c);
      row.later += live.later; row.next += live.next; row.current += live.current;
      row.overdue += Number(c.overdue_balance) || 0;
      row.bad += Number(c.bad_balance) || 0;
      const normalSource = (Number(c.normal_later_balance) || 0)
        + (Number(c.normal_next_balance) || 0) + (Number(c.normal_current_balance) || 0);
      row.normalCollected += (Number(c.normal_collected) || 0)
        + Math.max(0, normalSource - (Number(c.normal_balance) || 0));
      row.overdueCollected += (Number(c.overdue_collected) || 0)
        + Math.max(0, (Number(c.overdue_source_balance) || 0) - (Number(c.overdue_balance) || 0));
    });
    row.normal = row.later + row.next + row.current;
    row.total = row.normal + row.overdue + row.bad;
    return row;
  }), [data.customers, units]);

  const total = (key) => sum(summary, key);
  const rate = (value, base) => base ? (value / base * 100).toFixed(1) + "%" : "0.0%";
  const sourceMonth = (data.uploads[0] && data.uploads[0].month) || thisMonth();
  const reportDate = data.meta.today || today();
  const reportMonth = Number(reportDate.slice(5, 7));
  const reportDay = Number(reportDate.slice(8, 10));

  async function exportReport(kind) {
    setExporting(true);
    try {
      if (!window.html2canvas) throw new Error("이미지 변환 모듈을 불러오지 못했습니다.");
      const canvas = await window.html2canvas(reportRef.current, {
        scale: 2, backgroundColor: "#eef1f6", useCORS: true,
      });
      const base = "채권요약현황_" + data.meta.today;
      if (kind === "png") {
        const link = document.createElement("a");
        link.download = base + ".png";
        link.href = canvas.toDataURL("image/png");
        link.click();
      } else {
        if (!window.PptxGenJS) throw new Error("PPT 변환 모듈을 불러오지 못했습니다.");
        const pptx = new window.PptxGenJS();
        pptx.layout = "LAYOUT_WIDE";
        pptx.author = "MEDPARK";
        const slide = pptx.addSlide();
        slide.background = { color: "EEF1F6" };
        slide.addText("㈜메드파크 채권요약현황", { x: .35, y: .12, w: 8, h: .34,
          fontFace: "Pretendard", fontSize: 17, bold: true, color: "16202E" });
        slide.addText("기준일 " + data.meta.today, { x: 10.2, y: .18, w: 2.75, h: .22,
          align: "right", fontFace: "Pretendard", fontSize: 9, color: "5C6B80" });
        const ratio = Math.min(12.65 / canvas.width, 6.8 / canvas.height);
        slide.addImage({ data: canvas.toDataURL("image/png"), x: .34, y: .52,
          w: canvas.width * ratio, h: canvas.height * ratio });
        await pptx.writeFile({ fileName: base + ".pptx" });
      }
      notify((kind === "png" ? "그림파일" : "PPT") + " 다운로드를 시작했습니다.");
    } catch (e) { notify(e.message, true); }
    finally { setExporting(false); }
  }

  return (
    <>
      <div className="export-actions">
        <span className="t-muted t-sm">결산회의용 다운로드</span>
        <button className="btn btn--sm" disabled={exporting} onClick={() => exportReport("png")}>그림파일(PNG)</button>
        <button className="btn btn--sm btn--primary" disabled={exporting} onClick={() => exportReport("pptx")}>PPT</button>
      </div>
      <div ref={reportRef} className="summary-export">
      <Card title={"1. 사업부별 채권 분류 현황 (" + reportDate + " 기준)"} flush>
        <div className="tablewrap summary-table">
          <table>
            <thead>
              <tr><th rowSpan="2">사업부</th><th colSpan="4" className="summary-head summary-head--normal">정상채권</th>
                <th rowSpan="2" className="summary-head summary-head--overdue">미수채권</th>
                <th rowSpan="2" className="summary-head summary-head--bad">부실채권</th>
                <th rowSpan="2" className="summary-head summary-head--total">합계</th>
                <th rowSpan="2" className="summary-head summary-head--total">미수채권 비중</th></tr>
              <tr><th>10월 이후</th><th>9월 분</th><th>8월 분(당월)</th><th>[소계]</th></tr>
            </thead>
            <tbody>{summary.map((r) => (
              <tr key={r.unit}><td className="t-strong">{unitNames[r.unit]}</td>
                <td className="r num summary-normal">{won(r.later)}</td>
                <td className="r num summary-normal">{won(r.next)}</td>
                <td className="r num summary-normal">{won(r.current)}</td>
                <td className="r num summary-subtotal">{won(r.normal)}</td>
                <td className="r num summary-overdue">{won(r.overdue)}</td>
                <td className="r num summary-bad">{won(r.bad)}</td>
                <td className="r num t-strong">{won(r.total)}</td>
                <td className="r num t-strong">{rate(r.overdue, r.total)}</td></tr>
            ))}</tbody>
            <tfoot><tr><td>합계</td><td className="r num">{won(total("later"))}</td>
              <td className="r num">{won(total("next"))}</td><td className="r num">{won(total("current"))}</td>
              <td className="r num summary-subtotal">{won(total("normal"))}</td>
              <td className="r num summary-overdue">{won(total("overdue"))}</td>
              <td className="r num">{won(total("bad"))}</td><td className="r num">{won(total("total"))}</td>
              <td className="r num">{rate(total("overdue"), total("total"))}</td></tr></tfoot>
          </table>
        </div>
        <div className="summary-note" data-html2canvas-ignore="true">현재 운영 기초자료 {data.customers.length}개 거래처 기준 · 금액 단위: 원</div>
      </Card>

      <Card title={"2. " + reportMonth + "월 수금실적 (" + reportMonth + "월 1일 기초 대비, "
        + reportMonth + "월 " + reportDay + "일 누계)"} flush>
        <div className="tablewrap summary-table">
          <table>
            <thead><tr><th rowSpan="2">사업부</th>
              <th colSpan="4" className="summary-head summary-head--normal">정상채권 (당월분)</th>
              <th colSpan="4" className="summary-head summary-head--overdue">미수채권 (부실채권 제외)</th></tr>
              <tr><th>기초</th><th>수금액</th><th>잔액</th><th>회수율</th>
                <th>기초</th><th>수금액</th><th>잔액</th><th>회수율</th></tr></thead>
            <tbody>{summary.map((r) => {
              const normalOpening = r.current + r.normalCollected;
              const overdueOpening = r.overdue + r.overdueCollected;
              return <tr key={r.unit}><td className="t-strong">{unitNames[r.unit]}</td>
                <td className="r num">{won(normalOpening)}</td><td className="r num summary-normal">{won(r.normalCollected)}</td>
                <td className="r num summary-subtotal">{won(r.current)}</td><td className="r num t-strong">{rate(r.normalCollected, normalOpening)}</td>
                <td className="r num">{won(overdueOpening)}</td><td className="r num summary-overdue">{won(r.overdueCollected)}</td>
                <td className="r num summary-subtotal">{won(r.overdue)}</td><td className="r num t-strong">{rate(r.overdueCollected, overdueOpening)}</td></tr>;
            })}</tbody>
            <tfoot><tr><td>합계</td>
              <td className="r num">{won(total("current") + total("normalCollected"))}</td>
              <td className="r num">{won(total("normalCollected"))}</td><td className="r num">{won(total("current"))}</td>
              <td className="r num">{rate(total("normalCollected"), total("current") + total("normalCollected"))}</td>
              <td className="r num">{won(total("overdue") + total("overdueCollected"))}</td>
              <td className="r num">{won(total("overdueCollected"))}</td><td className="r num">{won(total("overdue"))}</td>
              <td className="r num">{rate(total("overdueCollected"), total("overdue") + total("overdueCollected"))}</td></tr></tfoot>
          </table>
        </div>
      </Card>
      </div>
    </>
  );
}

/* ═══════════════ 결산회의용 부서별 미수채권현황 ═══════════════ */

function ClosingReceivables({ data, notify }) {
  const [unit, setUnit] = useState("전체");
  const reportRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const unitNames = { 덴탈: "국내덴탈", 메디컬: "국내메디컬", 에스테틱: "국내에스테틱" };
  const units = unit === "전체" ? data.meta.units : [unit];

  const reports = useMemo(() => units.map((bizUnit) => {
    const customers = customersForUnit(data.customers, bizUnit);
    const rawDetail = customers.flatMap((c) => {
      const notes = [c.note, ...(c.detail_notes || [])].filter(Boolean);
      return [{ ...c, category: "미수채권", amount: Number(c.overdue_balance) || 0,
        months: overdueMonths(c.overdue_days), notes }].filter((row) => row.amount > 0);
    }).sort((a, b) => b.amount - a.amount);
    let detail = rawDetail;
    if (bizUnit === "에스테틱") {
      const small = rawDetail.filter((row) => row.amount <= 110000);
      const regular = rawDetail.filter((row) => row.amount > 110000);
      if (small.length) {
        const representative = small[0];
        detail = [...regular, {
          ...representative,
          code: "esthetic-small-group",
          name: representative.name + (small.length > 1 ? " 외 " + (small.length - 1) + "개처" : ""),
          amount: sum(small, "amount"),
          period: null,
          months: Math.max(...small.map((row) => row.months)),
          notes: [...new Set(small.flatMap((row) => row.notes))],
          grouped: true,
        }];
      }
    }
    const overdueBalance = sum(customers, "overdue_balance");
    const overdueCollected = sum(customers, "overdue_collected");
    const overdueOpening = overdueBalance + overdueCollected;
    const normalBalance = sum(customers, "normal_balance");
    const normalCollected = sum(customers, "normal_collected");
    return { unit: bizUnit, customers, detail, overdueBalance, overdueCollected,
      overdueOpening, normalBalance, normalCollected, normalOpening: normalBalance + normalCollected };
  }).filter((report) => report.overdueBalance > 0), [data.customers, units.join("|")]);

  const rate = (paid, opening) => opening ? (paid / opening * 100).toFixed(1) + "%" : "0.0%";

  async function exportReport(kind) {
    setExporting(true);
    try {
      if (!window.html2canvas) throw new Error("이미지 변환 모듈을 불러오지 못했습니다.");
      const canvas = await window.html2canvas(reportRef.current, { scale: 2, backgroundColor: "#eef1f6", useCORS: true });
      const base = "결산회의_부서별_미수채권현황_" + data.meta.today;
      if (kind === "png") {
        const link = document.createElement("a"); link.download = base + ".png";
        link.href = canvas.toDataURL("image/png"); link.click();
      } else {
        if (!window.PptxGenJS) throw new Error("PPT 변환 모듈을 불러오지 못했습니다.");
        const pptx = new window.PptxGenJS(); pptx.layout = "LAYOUT_WIDE"; pptx.author = "MEDPARK";
        const pageHeight = Math.floor(canvas.width * 6.75 / 12.65);
        const reportBox = reportRef.current.getBoundingClientRect();
        const scaleY = canvas.height / reportBox.height;
        const rowCuts = [...reportRef.current.querySelectorAll(
          ".closing-detail tbody tr, .closing-detail tfoot tr"
        )].map((row) => Math.min(canvas.height,
          Math.round((row.getBoundingClientRect().bottom - reportBox.top) * scaleY) + 2
        )).sort((a, b) => a - b);
        let top = 0;
        while (top < canvas.height) {
          const desiredBottom = Math.min(canvas.height, top + pageHeight);
          const safeCuts = rowCuts.filter((cut) => cut > top + 80 && cut <= desiredBottom);
          const bottom = desiredBottom === canvas.height ? canvas.height
            : (safeCuts.length ? safeCuts[safeCuts.length - 1] : desiredBottom);
          const slice = document.createElement("canvas"); slice.width = canvas.width;
          slice.height = bottom - top;
          slice.getContext("2d").drawImage(canvas, 0, top, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
          const slide = pptx.addSlide(); slide.background = { color: "EEF1F6" };
          slide.addText("㈜메드파크 결산회의용 부서별 미수채권현황", { x: .35, y: .1, w: 9, h: .3,
            fontFace: "Pretendard", fontSize: 16, bold: true, color: "16202E" });
          slide.addText("기준일 " + data.meta.today, { x: 10.2, y: .15, w: 2.75, h: .2, align: "right", fontSize: 9, color: "5C6B80" });
          slide.addImage({ data: slice.toDataURL("image/png"), x: .34, y: .48, w: 12.65,
            h: 12.65 * slice.height / slice.width });
          top = bottom;
        }
        await pptx.writeFile({ fileName: base + ".pptx" });
      }
      notify((kind === "png" ? "그림파일" : "PPT") + " 다운로드를 시작했습니다.");
    } catch (e) { notify(e.message, true); }
    finally { setExporting(false); }
  }

  return <>
    <div className="closing-toolbar">
      <Field label="사업부"><select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
        <option>전체</option>{data.meta.units.map((u) => <option key={u}>{u}</option>)}
      </select></Field>
      <div className="spacer" /><span className="t-muted t-sm">결산회의용 다운로드</span>
      <button className="btn btn--sm" disabled={exporting} onClick={() => exportReport("png")}>그림파일(PNG)</button>
      <button className="btn btn--sm btn--primary" disabled={exporting} onClick={() => exportReport("pptx")}>PPT</button>
    </div>
    <div ref={reportRef} className="closing-report">
      {reports.length === 0 && <Card><div className="zero-result">조회 대상 채권이 없습니다.</div></Card>}
      {reports.map((report) => <Card key={report.unit}
        title={(unitNames[report.unit] || report.unit) + " · 미수채권현황"} flush>
        <div className="closing-meta">기준일 {data.meta.today} · 잔액이 있는 채권만 표시</div>
        <div className="tablewrap"><table className="closing-summary"><thead><tr>
          <th>구분</th><th className="r">기초</th><th className="r">수금액</th><th className="r">잔액</th><th className="r">회수율</th><th>주요사항</th>
        </tr></thead><tbody>
          <tr className="closing-summary--overdue"><td>미수채권</td>
            <td className="r num">{won(report.overdueOpening)}</td><td className="r num">{won(report.overdueCollected)}</td>
            <td className="r num t-strong">{won(report.overdueBalance)}</td>
            <td className="r num">{rate(report.overdueCollected, report.overdueOpening)}</td>
            <td>{report.detail.filter((x) => x.notes.length).length}개 거래처 특이사항 등록</td></tr>
          {report.normalOpening > 0 && <tr><td>정상채권 (수금 대상)</td>
            <td className="r num">{won(report.normalOpening)}</td><td className="r num">{won(report.normalCollected)}</td>
            <td className="r num t-strong">{won(report.normalBalance)}</td>
            <td className="r num">{rate(report.normalCollected, report.normalOpening)}</td><td /></tr>}
        </tbody></table></div>
        <div className="tablewrap"><table className="closing-detail"><thead><tr>
          <th>거래처명</th><th>사업부</th><th className="r">회수기간</th><th className="r">연체기간</th>
          <th>채권구분</th><th className="r">채권잔액</th><th>특이사항</th>
        </tr></thead><tbody>{report.detail.map((row) => <tr key={row.code + row.category}>
          <td className="t-strong">{row.name}</td><td>{report.unit}</td>
          <td className={(row.period == null || Number(row.period) < 0) ? "customer-period--missing" : "r num"}>
            {row.grouped ? "합산" : row.period == null || Number(row.period) < 0 ? "미입력" : Number(row.period) + "개월"}</td>
          <td className="r num">{row.months}개월</td><td><Badge status="연체" /></td>
          <td className="r num closing-amount">{won(row.amount)}</td>
          <td className="closing-notes">{row.notes.join(" · ") || "–"}</td>
        </tr>)}</tbody><tfoot><tr><td colSpan={5}>합계 · {report.detail.length}건</td>
          <td className="r num">{won(sum(report.detail, "amount"))}</td><td /></tr></tfoot></table></div>
      </Card>)}
    </div>
  </>;
}

/* ══════════════════ 거래처별 현황 ══════════════════ */

function InlineEdit({ value, type = "text", placeholder, canEdit, onSave, formatValue }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  useEffect(() => { if (!editing) setDraft(value || ""); }, [value, editing]);

  async function commit() {
    setEditing(false);
    if (draft === (value || "")) return;
    await onSave(draft);
  }

  if (!editing) return (
    <button type="button" className="inline-edit" disabled={!canEdit}
      onClick={() => canEdit && setEditing(true)}>
      {value !== "" && value != null ? (formatValue ? formatValue(value) : value) :
        <span className="t-muted">{placeholder}</span>}
    </button>
  );
  return <input className="input input--compact" type={type} value={draft} autoFocus
    onChange={(e) => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(false); }} />;
}

function Customers({ data, can, preset, notify, patchCustomer }) {
  const [unit, setUnit] = useState((preset && preset.unit) || "전체");
  const [type, setType] = useState((preset && preset.status) || "전체");
  const [q, setQ] = useState("");
  const [periodFilter, setPeriodFilter] = useState("전체");
  const [ownerFilter, setOwnerFilter] = useState("전체");
  const [ageFilter, setAgeFilter] = useState("전체");
  const [editingNote, setEditingNote] = useState(null);
  const [draftNote, setDraftNote] = useState("");
  const [receivableDetail, setReceivableDetail] = useState(null);

  useEffect(() => { if (preset) { setUnit(preset.unit); setType(preset.status); } }, [preset]);

  const rows = useMemo(() => customersForUnit(data.customers, unit).flatMap((c) => {
    const parts = [
      { status: "정상", balance: Number(c.normal_balance) || 0, months: 0 },
      { status: "연체", balance: Number(c.overdue_balance) || 0, months: overdueMonths(c.overdue_days) },
      { status: "부실", balance: Number(c.bad_balance) || 0, months: overdueMonths(c.overdue_days) },
    ].filter((part) => part.balance !== 0);
    return parts.map((part, index) => ({ ...c, ...part, advance: index === 0 ? c.advance : 0,
      rowKey: c.code + "-" + c.biz_unit + "-" + part.status }));
  }).filter((c) => {
    if (type !== "전체" && c.status !== type) return false;
    const missingPeriod = c.period == null || Number(c.period) < 0;
    if (periodFilter === "미입력" && !missingPeriod) return false;
    if (periodFilter === "입력" && missingPeriod) return false;
    if (ownerFilter === "미배정" && c.owner) return false;
    if (ownerFilter !== "전체" && ownerFilter !== "미배정" && c.owner !== ownerFilter) return false;
    if (ageFilter === "0" && c.months !== 0) return false;
    if (ageFilter === "1-3" && (c.months < 1 || c.months > 3)) return false;
    if (ageFilter === "4-11" && (c.months < 4 || c.months > 11)) return false;
    if (ageFilter === "12+" && c.months < 12) return false;
    if (q && !(c.name.includes(q) || c.code.includes(q) || code5(c.code).includes(q)
      || (c.owner || "").includes(q))) return false;
    return true;
  }), [data.customers, unit, type, q, periodFilter, ownerFilter, ageFilter]);

  const owners = useMemo(() => [...new Set(data.customers.map((c) => c.owner).filter(Boolean))].sort(), [data.customers]);

  async function updateCustomer(code, body, message) {
    try {
      const { customer } = await api("/tf/ar/api/customers/" + encodeURIComponent(code), { method: "PATCH", body });
      patchCustomer(customer); notify(message);
    } catch (e) { notify(e.message, true); }
  }

  async function saveNote(code) {
    await updateCustomer(code, { note: draftNote }, "비고를 저장했습니다.");
    setEditingNote(null);
  }

  async function openReceivables(c) {
    try {
      const result = await api("/tf/ar/api/customers/" + encodeURIComponent(c.code) + "/receivables");
      setReceivableDetail({ ...result, name: c.name });
    } catch (e) { notify(e.message, true); }
  }

  async function saveItemTarget(itemId, target_date) {
    try {
      const result = await api("/tf/ar/api/receivables/" + itemId, { method: "PATCH", body: { target_date } });
      setReceivableDetail((d) => ({ ...d, items: d.items.map((x) => x.id === itemId ? result.item : x) }));
      notify("채권별 수금목표일을 저장했습니다.");
    } catch (e) { notify(e.message, true); }
  }

  async function saveItemNote(itemId, note) {
    try {
      const result = await api("/tf/ar/api/receivables/" + itemId, { method: "PATCH", body: { note } });
      const items = receivableDetail.items.map((x) => x.id === itemId ? result.item : x);
      setReceivableDetail((d) => ({ ...d, items }));
      patchCustomer({ ...receivableDetail.customer,
        detail_notes: [...new Set(items.map((x) => x.note).filter(Boolean))] });
      notify("채권 비고를 저장하고 거래처 현황에 취합 반영했습니다.");
    } catch (e) { notify(e.message, true); }
  }

  async function reclassifyAsOverdue(item) {
    if (!window.confirm(won(item.balance) + "원을 정상채권에서 미수채권으로 전환할까요?")) return;
    try {
      const result = await api("/tf/ar/api/receivables/" + item.id, {
        method: "PATCH", body: { category: "연체" },
      });
      setReceivableDetail((d) => ({ ...d, customer: result.customer,
        items: d.items.map((x) => x.id === item.id ? { ...result.item, as_of_status: "연체" } : x) }));
      patchCustomer(result.customer);
      notify("정상채권을 미수채권으로 전환했습니다.");
    } catch (e) { notify(e.message, true); }
  }

  const distinctCustomers = new Set(rows.map((r) => r.code)).size;

  return (
    <>
      <Card title="조회 조건">
        <div className="customer-filters">
          <Field label="사업부별 필터"><select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option>전체</option>{data.meta.units.map((u) => <option key={u}>{u}</option>)}
          </select></Field>
          <Field label="채권유형별 필터"><select className="select" value={type} onChange={(e) => setType(e.target.value)}>
            <option>전체</option>{data.meta.statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select></Field>
          <Field label="회수기간"><select className="select" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
            <option>전체</option><option>미입력</option><option>입력</option>
          </select></Field>
          <Field label="담당자"><select className="select" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
            <option>전체</option><option>미배정</option>{owners.map((o) => <option key={o}>{o}</option>)}
          </select></Field>
          <Field label="연체기간"><select className="select" value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)}>
            <option value="전체">전체</option><option value="0">0개월</option><option value="1-3">1~3개월</option>
            <option value="4-11">4~11개월</option><option value="12+">12개월 이상</option>
          </select></Field>
          <Field label="거래처 검색"><input className="input" lang="ko" inputMode="text" value={q} placeholder="거래처명·코드·담당자"
            onChange={(e) => setQ(e.target.value)} /></Field>
          <button className="btn btn--sm" onClick={() => { setUnit("전체"); setType("전체"); setPeriodFilter("전체"); setOwnerFilter("전체"); setAgeFilter("전체"); setQ(""); }}>초기화</button>
        </div>
      </Card>

      <Card title={(STATUS_LABEL[type] || type) + " · 거래처 " + distinctCustomers + "곳 / 채권 " + rows.length + "건"} flush>
          <div className="tablewrap customer-table"><table>
            <thead><tr><th>코드</th><th>거래처명</th><th>사업부</th><th>채권유형</th><th>회수기간</th><th>담당자</th>
              <th>수금목표일</th><th className="r">채권잔액</th><th className="r">선수금</th>
              <th className="r">연체기간(개월)</th><th>최종수금일</th><th style={{ minWidth: 180 }}>비고</th></tr></thead>
            <tbody>{rows.map((c) => <tr key={c.rowKey}>
              <td className="num t-muted">{code5(c.code)}</td><td className="t-strong">{c.name}</td>
              <td>{c.biz_unit}</td><td><Badge status={c.status} /></td>
              <td className={"num" + (c.period == null || Number(c.period) < 0 ? " customer-period--missing" : "")}>
                <InlineEdit value={c.period == null || Number(c.period) < 0 ? "" : String(c.period)}
                  placeholder="미입력" type="number" canEdit={can("customer_info_edit")}
                  formatValue={(value) => Number(value) === 0 ? "0개월 (당월)" :
                    Number(value) === 1 ? "1개월 (익월)" : value + "개월"}
                  onSave={(period) => updateCustomer(c.code, { period }, "회수기간을 저장했습니다.")} />
              </td>
              <td><InlineEdit value={c.owner} placeholder="클릭해 입력" canEdit={can("note_edit")}
                onSave={(owner) => updateCustomer(c.code, { owner }, "담당자를 저장했습니다.")} /></td>
              <td><button type="button" className="inline-edit" onClick={() => openReceivables(c)}>
                채권별 목표 설정</button></td>
              <td className="r num t-strong">{won(c.balance)}</td>
              <td className="r num">{c.advance ? won(c.advance) : "–"}</td>
              <td className="r num">{c.months}개월</td><td className="num t-muted t-sm">{c.last_paid_at || "–"}</td>
              <td style={{ whiteSpace: "normal" }}>{editingNote === c.rowKey ? <div className="inline-note">
                <input className="input" value={draftNote} autoFocus onChange={(e) => setDraftNote(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveNote(c.code)} />
                <button className="btn btn--sm btn--primary" onClick={() => saveNote(c.code)}>저장</button>
                <button className="btn btn--sm" onClick={() => setEditingNote(null)}>취소</button>
              </div> : <button type="button" className="inline-edit" disabled={!can("note_edit")}
                onClick={() => { setEditingNote(c.rowKey); setDraftNote(c.note || ""); }}>
                {[c.note, ...(c.detail_notes || [])].filter(Boolean).join(" · ") || <span className="t-muted">클릭해 입력</span>}</button>}</td>
            </tr>)}</tbody>
            {rows.length === 0 && <tbody><tr><td colSpan={12} className="zero-result">조회 결과 <b>0원</b></td></tr></tbody>}
            <tfoot><tr><td colSpan={7}>합계 · 거래처 {distinctCustomers}곳 / 채권 {rows.length}건</td>
              <td className="r num">{won(sum(rows, "balance"))}</td><td className="r num">{won(sum(rows, "advance"))}</td>
              <td colSpan={3} /></tr></tfoot>
          </table></div>
      </Card>
      {receivableDetail && <div className="modal-backdrop" onMouseDown={() => setReceivableDetail(null)}>
        <section className="modal-card modal-card--wide" onMouseDown={(e) => e.stopPropagation()}>
          <header className="card__head"><h3>{receivableDetail.name} · 발생월별 채권 상세</h3>
            <div className="spacer" /><button className="btn btn--sm" onClick={() => setReceivableDetail(null)}>닫기</button></header>
          <div className="alert alert--info" style={{ margin: 14 }}>
            조회기준일 {receivableDetail.as_of} · 발생월별 잔액과 정상회수월을 확인하고 채권별 목표일을 입력합니다.
          </div>
          <div className="tablewrap"><table>
            <thead><tr><th>사업부</th><th>채권발생월</th><th>정상회수월</th><th>현재 구분</th>
              <th className="r">최초금액</th><th className="r">현재잔액</th><th>수금목표일</th><th>비고</th><th>관리</th></tr></thead>
            <tbody>{receivableDetail.items.map((item) => <tr key={item.id}>
              <td className="t-strong">{item.biz_unit || receivableDetail.customer.biz_unit}</td>
              <td className="num t-strong">{item.issue_month || "미확인"}</td>
              <td className="num">{item.target_month || "미입력"}</td><td><Badge status={item.as_of_status || item.category} /></td>
              <td className="r num">{won(item.original_amount)}</td><td className="r num t-strong">{won(item.balance)}</td>
              <td><InlineEdit value={item.target_date} placeholder="목표일 입력" type="date"
                canEdit={can("customer_info_edit")} onSave={(value) => saveItemTarget(item.id, value)} /></td>
              <td><InlineEdit value={item.note} placeholder="비고 입력" canEdit={can("note_edit")}
                onSave={(value) => saveItemNote(item.id, value)} /></td>
              <td>{item.category === "정상" && Number(item.balance) > 0 ?
                <button className="btn btn--sm btn--warn" disabled={!can("customer_info_edit")}
                  onClick={() => reclassifyAsOverdue(item)}>미수 전환</button> : "–"}</td>
            </tr>)}</tbody>
          </table></div>
        </section>
      </div>}
    </>
  );
}

/* ══════════════════ 담당자별 채권현황 ══════════════════ */

function Owners({ data }) {
  const [owner, setOwner] = useState("전체");
  const list = useMemo(() => {
    const map = {};
    data.customers.forEach((c) => {
      const k = c.owner || "미지정";
      map[k] = map[k] || { owner: k, rows: [], total: 0, 정상: 0, 연체: 0, 부실: 0 };
      map[k].rows.push(c); map[k].total += c.balance; map[k][c.status] += c.balance;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [data.customers]);

  const active = owner === "전체" ? null : list.find((o) => o.owner === owner);

  return (
    <>
      <div className="chiprow">
        <button className="chip" aria-pressed={owner === "전체"} onClick={() => setOwner("전체")}>전체</button>
        {list.map((o) => (
          <button key={o.owner} className="chip" aria-pressed={owner === o.owner}
            onClick={() => setOwner(o.owner)}>{o.owner} ({o.rows.length})</button>
        ))}
      </div>

      <div className="grid grid--3">
        {(active ? [active] : list).map((o) => (
          <Card key={o.owner} title={o.owner}>
            <div className="kpi__value num" style={{ marginTop: 0 }}>
              {short(o.total).value}<em>{short(o.total).unit}</em>
            </div>
            <div className="kpi__meta num" style={{ marginBottom: 12 }}>
              거래처 {o.rows.length}곳 · {won(o.total)}원
            </div>
            <div className="signal__bar">
              {["정상", "연체", "부실"].map((s) => o[s] > 0 && (
                <div key={s} className={"signal__seg signal__seg--" + STATUS_STYLE[s]}
                  style={{ width: (o[s] / o.total) * 100 + "%" }} title={STATUS_LABEL[s] + " " + won(o[s])} />
              ))}
            </div>
          </Card>
        ))}
      </div>

      {active && (
        <Card title={active.owner + " 담당 거래처"} flush>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>코드</th><th>거래처명</th><th>사업부</th><th>분류</th>
                  <th className="r">채권잔액</th><th className="r">연체기간(개월)</th><th>비고</th></tr>
              </thead>
              <tbody>
                {[...active.rows].sort((a, b) => b.balance - a.balance).map((c) => (
                  <tr key={c.code}>
                    <td className="num t-muted">{code5(c.code)}</td>
                    <td className="t-strong">{c.name}</td>
                    <td>{c.biz_unit}</td>
                    <td><Badge status={c.status} /></td>
                    <td className="r num t-strong">{won(c.balance)}</td>
                    <td className="r num">{overdueMonths(c.overdue_days)}개월</td>
                    <td className="t-sm t-muted" style={{ whiteSpace: "normal" }}>{c.note || "–"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={4}>합계</td><td className="r num">{won(active.total)}</td><td colSpan={2} /></tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

/* ══════════════════ 수금 등록 ══════════════════ */

function CustomerSearch({ customers, value, onChange }) {
  const selected = customers.find((c) => c.code === value);
  const [query, setQuery] = useState(selected ? selected.name : "");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return customers.filter((c) => !keyword
      || c.name.toLowerCase().includes(keyword)
      || String(c.code).toLowerCase().includes(keyword)
      || code5(c.code).includes(keyword)).slice(0, 12);
  }, [customers, query]);

  useEffect(() => {
    if (!value) setQuery("");
  }, [value]);

  function choose(customer) {
    onChange(customer.code);
    setQuery(customer.name);
    setOpen(false);
  }

  return (
    <div className="customer-search">
      <input className="input" lang="ko" inputMode="text" value={query} placeholder="거래처명 또는 코드 검색"
        role="combobox" aria-expanded={open} aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQuery(e.target.value); onChange(""); setOpen(true); }} />
      {open && (
        <div className="customer-search__menu" role="listbox">
          {matches.map((c) => (
            <button type="button" role="option" key={c.code}
              className="customer-search__option" onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}>
              <span><b>{c.name}</b><small>{code5(c.code)} · {c.biz_unit}</small></span>
              <strong className="num">{won(c.balance)}원</strong>
            </button>
          ))}
          {matches.length === 0 && <div className="customer-search__empty">검색 결과가 없습니다.</div>}
        </div>
      )}
    </div>
  );
}

function Collections({ data, can, notify, refresh }) {
  const [form, setForm] = useState({
    customer_code: "", amount: "", method: "계좌수금", paid_at: today(), note: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setAmount = (e) => setForm({ ...form, amount: formatAmountInput(e.target.value) });

  const pending = data.collections.filter((c) => c.state === "pending");
  const decided = data.collections.filter((c) => c.state !== "pending").slice(0, 40);
  const target = data.customers.find((c) => c.code === form.customer_code);

  async function register() {
    setBusy(true);
    try {
      await api("/tf/ar/api/collections", { method: "POST", body: form });
      notify("수금 건을 등록했습니다. 재무담당 승인 후 잔액에 반영됩니다.");
      setForm({ ...form, customer_code: "", amount: "", note: "" });
      await refresh();
    } catch (e) { notify(e.message, true); }
    setBusy(false);
  }

  async function decide(id, action) {
    try {
      const body = action === "reject" ? { reason: prompt("반려 사유를 입력하세요.") || "" } : {};
      await api("/tf/ar/api/collections/" + id + "/" + action, { method: "POST", body });
      notify(action === "approve" ? "승인했습니다. 잔액이 갱신되었습니다." : "반려했습니다.");
      await refresh();
    } catch (e) { notify(e.message, true); }
  }

  return (
    <>
      {can("collection_register") && (
        <Card title="수금 등록">
          <div className="formrow">
            <Field label="거래처">
              <CustomerSearch customers={data.customers} value={form.customer_code}
                onChange={(code) => setForm({ ...form, customer_code: code })} />
            </Field>
            <Field label="수금액 (원)">
              <input className="input num" inputMode="numeric" value={form.amount}
                onChange={setAmount} placeholder="0" aria-describedby="collection-amount-unit" />
              <small id="collection-amount-unit" className="amount-unit-check">
                {form.amount ? "입력금액 · " + koreanAmountUnit(form.amount) : "숫자를 입력하면 금액 단위가 표시됩니다."}
              </small>
            </Field>
            <Field label="수금방법">
              <select className="select" value={form.method} onChange={set("method")}>
                {data.meta.methods.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="수금일">
              <input className="input" type="date" value={form.paid_at} onChange={set("paid_at")} />
            </Field>
          </div>
          <Field label="비고">
            <input className="input" value={form.note} onChange={set("note")}
              placeholder="입금자명, 분할 회차 등" />
          </Field>
          {target && amountNumber(form.amount) > target.balance && (
            <div className="alert alert--warn">
              입력한 수금액이 현재 미수잔액({won(target.balance)}원)보다 큽니다. 금액을 확인하세요.
            </div>
          )}
          <button className="btn btn--primary" onClick={register}
            disabled={busy || !form.customer_code || !form.amount}>
            승인 요청으로 등록
          </button>
        </Card>
      )}

      <Card title={"승인 대기 " + pending.length + "건"} flush>
        {pending.length === 0 ? (
          <Empty title="대기 중인 수금 건이 없습니다.">영업담당이 등록하면 이곳에 표시됩니다.</Empty>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>등록일</th><th>거래처</th><th className="r">수금액</th><th>방법</th>
                  <th>수금일</th><th>등록자</th><th>비고</th><th /></tr>
              </thead>
              <tbody>
                {pending.map((c) => (
                  <tr key={c.id}>
                    <td className="t-sm t-muted num">{(c.created_at || "").slice(0, 10)}</td>
                    <td className="t-strong">{c.customer_name}</td>
                    <td className="r num t-strong">{won(c.amount)}</td>
                    <td>{c.method}</td>
                    <td className="num">{c.paid_at}</td>
                    <td>{c.registered_by}</td>
                    <td className="t-sm t-muted" style={{ whiteSpace: "normal" }}>{c.note || "–"}</td>
                    <td className="r">
                      {can("collection_approve") ? (
                        <div className="btnrow" style={{ justifyContent: "flex-end" }}>
                          <button className="btn btn--sm btn--ok" onClick={() => decide(c.id, "approve")}>승인</button>
                          <button className="btn btn--sm btn--danger" onClick={() => decide(c.id, "reject")}>반려</button>
                        </div>
                      ) : <span className="badge badge--mute">승인 대기</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={2}>대기 합계</td><td className="r num">{won(sum(pending, "amount"))}</td>
                  <td colSpan={5} /></tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card title="처리 내역" flush>
        {decided.length === 0 ? <Empty title="처리된 내역이 없습니다." /> : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>상태</th><th>거래처</th><th className="r">수금액</th><th>방법</th>
                  <th>수금일</th><th>등록자</th><th>처리자</th><th>사유·비고</th></tr>
              </thead>
              <tbody>
                {decided.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className={"badge badge--" + (c.state === "approved" ? "ok" : "bad")}>
                        {c.state === "approved" ? "승인" : "반려"}
                      </span>
                    </td>
                    <td className="t-strong">{c.customer_name}</td>
                    <td className="r num">{won(c.amount)}</td>
                    <td>{c.method}</td>
                    <td className="num">{c.paid_at}</td>
                    <td>{c.registered_by}</td>
                    <td>{c.approved_by}</td>
                    <td className="t-sm t-muted" style={{ whiteSpace: "normal" }}>
                      {c.reject_reason || c.note || "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/* ══════════════════ 수금목표 관리 ══════════════════ */

function Targets({ data, notify, refresh }) {
  const blank = {
    customer_code: "", amount: "", target_date: today(), method: "계좌수금", assignee: "", note: "",
  };
  const [form, setForm] = useState(blank);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const [filter, setFilter] = useState("진행");

  const rows = data.targets.filter((t) =>
    filter === "전체" ? true : filter === "완료" ? t.state === "done" : t.state !== "done");

  async function create() {
    try {
      await api("/tf/ar/api/targets", { method: "POST", body: form });
      setForm(blank); notify("수금목표를 추가했습니다."); await refresh();
    } catch (e) { notify(e.message, true); }
  }
  async function patch(id, body) {
    try { await api("/tf/ar/api/targets/" + id, { method: "PATCH", body }); await refresh(); }
    catch (e) { notify(e.message, true); }
  }
  async function remove(id) {
    if (!confirm("이 목표를 삭제할까요?")) return;
    try { await api("/tf/ar/api/targets/" + id, { method: "DELETE" }); notify("삭제했습니다."); await refresh(); }
    catch (e) { notify(e.message, true); }
  }

  return (
    <>
      <Card title="수금목표 추가">
        <div className="formrow">
          <Field label="거래처">
            <CustomerSearch customers={data.customers} value={form.customer_code}
              onChange={(code) => setForm({ ...form, customer_code: code })} />
          </Field>
          <Field label="목표금액 (원)">
            <input className="input num" inputMode="numeric" value={form.amount} onChange={set("amount")} />
          </Field>
          <Field label="목표일">
            <input className="input" type="date" value={form.target_date} onChange={set("target_date")} />
          </Field>
          <Field label="수금방법">
            <select className="select" value={form.method} onChange={set("method")}>
              {data.meta.methods.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="담당자">
            <input className="input" value={form.assignee} onChange={set("assignee")} placeholder="이름" />
          </Field>
        </div>
        <Field label="비고">
          <input className="input" value={form.note} onChange={set("note")}
            placeholder="약속 내용, 연락 결과 등" />
        </Field>
        <button className="btn btn--primary" onClick={create}
          disabled={!form.customer_code || !form.target_date}>목표 추가</button>
      </Card>

      <Card title={"수금목표 " + rows.length + "건"} flush
        actions={<div className="chiprow">
          {["진행", "완료", "전체"].map((f) => (
            <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>}>
        {rows.length === 0 ? <Empty title="등록된 목표가 없습니다.">위에서 첫 목표를 추가하세요.</Empty> : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>목표일</th><th>거래처</th><th className="r">목표금액</th><th>수금방법</th>
                  <th>담당자</th><th>완료일</th><th>비고</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const late = t.state !== "done" && t.target_date < today();
                  return (
                    <tr key={t.id}>
                      <td className="num" style={{ color: late ? "var(--bad)" : "inherit", fontWeight: late ? 600 : 400 }}>
                        {t.target_date}{late && " ⚠"}
                      </td>
                      <td className="t-strong">{t.customer_name}</td>
                      <td className="r num">{won(t.amount)}</td>
                      <td>{t.method || "–"}</td>
                      <td>{t.assignee || "–"}</td>
                      <td>
                        <input className="input num" type="date" style={{ width: 148 }}
                          value={t.done_date || ""}
                          onChange={(e) => patch(t.id, { done_date: e.target.value })} />
                      </td>
                      <td style={{ whiteSpace: "normal", minWidth: 180 }}>
                        <input className="input" defaultValue={t.note}
                          onBlur={(e) => e.target.value !== t.note && patch(t.id, { note: e.target.value })} />
                      </td>
                      <td className="r">
                        <button className="btn btn--sm btn--danger" onClick={() => remove(t.id)}>삭제</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={2}>합계</td><td className="r num">{won(sum(rows, "amount"))}</td>
                  <td colSpan={5} /></tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/* ══════════════════ 출고 데이터 업로드 ══════════════════ */

const COLUMN_ALIASES = {
  code: ["거래처코드", "코드", "거래처 코드", "고객코드", "code"],
  name: ["거래처명", "거래처", "업체명", "고객명", "고객", "name"],
  biz_unit: ["사업부", "사업부문", "부문", "대분류", "unit"],
  status: ["채권분류", "분류", "채권상태", "상태", "status"],
  collection_period: ["회수기간(개월)", "회수기간", "collection_period"],
  shipment_amount: ["출고금액", "출고액", "합계액", "shipment_amount"],
  balance: ["미수잔액", "미수금액", "채권잔액", "잔액", "미수금", "balance"],
  normal_balance: ["정상채권잔액", "정상채권", "normal_balance"],
  normal_later_balance: ["차차월이후정상채권", "차차월이후", "10월이후수금대상", "정상채권10월이후", "normal_later_balance"],
  normal_next_balance: ["익월정상채권", "익월", "9월수금대상", "정상채권9월분", "normal_next_balance"],
  normal_current_balance: ["당월정상채권", "당월", "8월수금대상", "정상채권8월분", "normal_current_balance"],
  normal_collected: ["정상채권수금현황", "정상채권수금액", "normal_collected"],
  overdue_balance: ["미수채권(11개월내)", "11개월내", "overdue_balance"],
  overdue_source_balance: ["미수채권기초잔액", "overdue_source_balance"],
  overdue_collected: ["미수채권수금현황", "미수채권수금액", "overdue_collected"],
  bad_balance: ["부실채권(12개월이상)", "12개월이상", "bad_balance"],
  advance: ["선수금", "선수금액", "advance"],
  overdue_months: ["연체기간(개월)", "연체개월", "연체기간개월"],
  overdue_days: ["경과일", "연체일", "경과일수", "연체일수"],
  last_paid_at: ["최종수금일", "최근수금일", "최종입금일"],
  note: ["비고", "특이사항", "메모"],
};

function mapHeaders(headers) {
  const map = {};
  const cleaned = headers.map((h) => String(h || "").replace(/\s/g, ""));
  // '고객'이 '고객코드'에 먼저 걸리는 일을 막기 위해 정확히 같은 머리글을 최우선으로 찾는다.
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const normalized = aliases.map((a) => a.replace(/\s/g, ""));
    const exact = cleaned.findIndex((header) => normalized.includes(header));
    if (exact >= 0) map[field] = exact;
  }
  // 과거 서식의 부가 문구가 붙은 머리글만 부분 일치로 보완한다.
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (map[field] !== undefined) continue;
    const normalized = aliases.map((a) => a.replace(/\s/g, ""));
    const fuzzy = cleaned.findIndex((header) => normalized.some((a) => a && header.includes(a)));
    if (fuzzy >= 0) map[field] = fuzzy;
  }
  return map;
}

function Upload({ data, can, notify, applyUpload, refresh }) {
  const [month, setMonth] = useState(thisMonth());
  const [shipmentDate, setShipmentDate] = useState(data.meta.today);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const lockOf = (m) => data.locks.find((l) => l.month === m);
  const locked = !!(lockOf(month) && lockOf(month).locked);

  function readFile(file) {
    setError(""); setParsed(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        let headerRow = -1, map = {};
        for (let i = 0; i < Math.min(grid.length, 15); i++) {
          const candidate = mapHeaders(grid[i] || []);
          if (candidate.code !== undefined && candidate.name !== undefined) {
            headerRow = i; map = candidate; break;
          }
        }
        if (headerRow < 0) {
          setError("머리글 행을 찾지 못했습니다. '거래처코드'와 '거래처명' 열이 있는지 확인하세요.");
          return;
        }
        const shipmentMode = map.shipment_amount !== undefined;
        const cleanHeaders = (grid[headerRow] || []).map((h) => String(h || "").replace(/\s/g, ""));
        const amaranthMode = ["고객코드", "고객", "대분류", "합계액"]
          .every((header) => cleanHeaders.includes(header));
        const required = shipmentMode
          ? ["code", "name", "biz_unit"]
          : ["code", "name", "biz_unit", "normal_balance", "overdue_balance", "bad_balance"];
        const missing = required.filter((field) => map[field] === undefined);
        if (missing.length) {
          setError("필수 열이 없습니다: " + missing.map((field) => ({
            code: "거래처코드", name: "거래처명", biz_unit: "사업부", normal_balance: "정상채권잔액",
            overdue_balance: "미수채권(11개월 내)", bad_balance: "부실채권(12개월 이상)",
            collection_period: "회수기간(개월)", shipment_amount: "출고금액",
          })[field]).join(", "));
          return;
        }
        const rows = [], issues = [];
        const unitMap = {
          "제품_덴탈_국내": "덴탈",
          "제품_메디컬_국내": "메디컬",
          "제품_에스테틱_국내": "에스테틱",
        };
        for (let i = headerRow + 1; i < grid.length; i++) {
          const raw = grid[i] || [];
          const pick = (f) => (map[f] === undefined ? "" : raw[map[f]]);
          const code = String(pick("code") || "").trim();
          if (!code || /^#REF|^#N\/A/.test(code)) continue;
          const normalizedCode = /^\d+$/.test(code) ? code.padStart(5, "0") : code;
          const name = String(pick("name") || "").trim();
          const rawBizUnit = String(pick("biz_unit") || "").trim();
          const bizUnit = amaranthMode ? (unitMap[rawBizUnit] || "") : rawBizUnit;
          if (!name) issues.push((i + 1) + "행: 거래처명 누락");
          if (!data.meta.units.includes(bizUnit)) issues.push((i + 1) + "행: 사업부 오류");
          const period = pick("collection_period");
          if (shipmentMode && period !== "" && (Number(period) < 0 || !Number.isFinite(Number(period)))) {
            issues.push((i + 1) + "행: 회수기간 오류");
          }
          rows.push({
            code: normalizedCode,
            name,
            biz_unit: bizUnit,
            status: String(pick("status") || "").trim(),
            owner: "",
            collection_period: period,
            shipment_amount: pick("shipment_amount"),
            balance: pick("balance"),
            normal_balance: pick("normal_balance"),
            normal_later_balance: pick("normal_later_balance"),
            normal_next_balance: pick("normal_next_balance"),
            normal_current_balance: pick("normal_current_balance"),
            normal_collected: pick("normal_collected"),
            overdue_balance: pick("overdue_balance"),
            overdue_source_balance: pick("overdue_source_balance") || pick("overdue_balance"),
            overdue_collected: pick("overdue_collected"),
            bad_balance: pick("bad_balance"),
            advance: pick("advance"),
            overdue_days: map.overdue_months !== undefined
              ? (Number(pick("overdue_months")) || 0) * 30 : pick("overdue_days"),
            last_paid_at: String(pick("last_paid_at") || "").trim(),
            note: String(pick("note") || "").trim(),
          });
        }
        let preparedRows = rows;
        let multiUnitCodes = [];
        if (amaranthMode) {
          const grouped = new Map();
          rows.forEach((r) => {
            const key = r.code + "|" + r.biz_unit;
            const current = grouped.get(key);
            if (current) current.shipment_amount = Number(current.shipment_amount || 0) + Number(r.shipment_amount || 0);
            else grouped.set(key, { ...r, shipment_amount: Number(r.shipment_amount || 0) });
          });
          preparedRows = Array.from(grouped.values());
          const unitsByCode = new Map();
          preparedRows.forEach((r) => {
            if (!unitsByCode.has(r.code)) unitsByCode.set(r.code, new Set());
            unitsByCode.get(r.code).add(r.biz_unit);
          });
          multiUnitCodes = Array.from(unitsByCode.entries())
            .filter(([, units]) => units.size > 1).map(([code]) => code);
        }
        const seen = new Set(), dupes = [];
        preparedRows.forEach((r) => {
          if (!amaranthMode && seen.has(r.code)) dupes.push(r.code);
          seen.add(r.code);
        });
        setParsed({ filename: file.name, rows: preparedRows, dupes, issues,
          mapped: Object.keys(map), amaranthMode, multiUnitCodes,
          mode: shipmentMode ? "shipment" : "snapshot" });
      } catch (err) {
        setError("파일을 읽지 못했습니다: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function send() {
    setBusy(true);
    try {
      const res = await api("/tf/ar/api/uploads", {
        method: "POST",
        body: { month, shipment_date: shipmentDate, filename: parsed.filename,
          rows: parsed.rows, mode: parsed.mode },
      });
      applyUpload(res);
      notify(res.inserted + "행을 반영했습니다. 기존 " + res.replaced + "행은 교체되었습니다.");
      setParsed(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) { notify(e.message, true); }
    setBusy(false);
  }

  async function toggleLock() {
    try {
      await api("/tf/ar/api/locks/" + month, { method: "POST", body: { locked: !locked } });
      notify(locked ? month + " 잠금을 해제했습니다." : month + " 을 마감 잠금했습니다.");
      await refresh();
    } catch (e) { notify(e.message, true); }
  }

  return (
    <>
      <Card title="출고 데이터 업로드">
        <div className="formrow">
          <Field label="기준월">
            <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <Field label="출고기준일">
            <input className="input" type="date" value={shipmentDate}
              onChange={(e) => setShipmentDate(e.target.value)} />
          </Field>
          <Field label="마감 상태">
            <div className="btnrow" style={{ alignItems: "center", minHeight: 38 }}>
              <span className={"badge badge--" + (locked ? "bad" : "ok")}>{locked ? "잠김" : "열림"}</span>
              {can("month_lock") && (
                <button className="btn btn--sm" onClick={toggleLock}>{locked ? "잠금 해제" : "마감 잠금"}</button>
              )}
            </div>
          </Field>
        </div>

        <div className={"dropzone" + (over ? " is-over" : "")}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); }}>
          <p style={{ margin: "0 0 10px" }}>엑셀 파일을 끌어다 놓거나 아래에서 선택하세요.</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
            onChange={(e) => e.target.files[0] && readFile(e.target.files[0])} />
          <p className="t-sm t-muted" style={{ margin: "12px 0 0" }}>
            아마란스10 출고현황 원본: E열 고객코드 · F열 고객 · AK열 대분류 · AB열 합계액을 자동 인식합니다.
          </p>
        </div>

        {error && <div className="alert alert--bad" style={{ marginTop: 12 }}>{error}</div>}
        {locked && (
          <div className="alert alert--warn" style={{ marginTop: 12 }}>
            {month} 은 마감 잠금 상태라 업로드할 수 없습니다. 잠금을 해제한 뒤 다시 시도하세요.
          </div>
        )}

        {parsed && (
          <div style={{ marginTop: 16 }}>
            <div className="alert alert--info">
              <b>{parsed.filename}</b> — 유효한 {parsed.rows.length}행을 읽었습니다.
              {parsed.amaranthMode && " 아마란스10 원본 서식으로 인식했습니다."}
              인식한 열: {parsed.mapped.length}개.
              {parsed.dupes.length > 0 && (parsed.amaranthMode
                ? " 복수 사업부 코드 " + parsed.dupes.length + "건을 사업부별로 분리합니다."
                : " 중복 코드 " + parsed.dupes.length + "건이 있습니다.")}
            </div>
            {(parsed.dupes.length > 0 || parsed.issues.length > 0) && (
              <div className="alert alert--bad" style={{ marginTop: 10 }}>
                업로드 전 수정 필요: {parsed.dupes.length > 0 && "중복 코드 " + parsed.dupes.join(", ")}
                {parsed.dupes.length > 0 && parsed.issues.length > 0 && " · "}
                {parsed.issues.slice(0, 8).join(" · ")}{parsed.issues.length > 8 && " 외 " + (parsed.issues.length - 8) + "건"}
              </div>
            )}
            <p className="t-sm t-muted">
              {parsed.mode === "shipment"
                ? month + " 출고분만 재설정하며 회수기간에 따라 수금대상월을 자동 산출합니다."
                : month + " 의 기존 확정 채권 데이터를 교체합니다."} 다른 월 데이터는 그대로 유지됩니다.
            </p>
            <div className="tablewrap" style={{ maxHeight: 260, overflowY: "auto", marginBottom: 12 }}>
              <table>
                <thead>
                  <tr><th>코드</th><th>거래처명</th><th>사업부</th>
                    <th>{parsed.mode === "shipment" ? "회수기간" : "분류"}</th>
                    <th className="r">{parsed.mode === "shipment" ? "출고금액" : "채권잔액"}</th></tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 12).map((r, i) => (
                    <tr key={i}>
                      <td className="num">{r.code}</td><td>{r.name}</td><td>{r.biz_unit || "–"}</td>
                      <td>{parsed.mode === "shipment" ? r.collection_period + "개월" : (r.status || "자동판정")}</td>
                      <td className="r num">{won(parsed.mode === "shipment" ? r.shipment_amount : r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btnrow">
              <button className="btn btn--primary" onClick={send}
                disabled={busy || locked || !shipmentDate || parsed.dupes.length > 0 || parsed.issues.length > 0}>
                {month} 데이터로 반영
              </button>
              <button className="btn" onClick={() => setParsed(null)}>취소</button>
            </div>
          </div>
        )}
      </Card>

      <Card title="업로드 이력" flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>업로드 일시</th><th>출고기준일</th><th>기준월</th><th>파일명</th><th className="r">반영 행</th>
                <th className="r">교체된 행</th><th>업로더</th><th>마감</th></tr>
            </thead>
            <tbody>
              {data.uploads.map((u) => {
                const l = lockOf(u.month);
                return (
                  <tr key={u.id}>
                    <td className="num t-sm">{u.uploaded_at}</td>
                    <td className="num t-sm">{u.shipment_date || "–"}</td>
                    <td className="num t-strong">{u.month}</td>
                    <td>{u.filename}</td>
                    <td className="r num">{u.row_count}</td>
                    <td className="r num t-muted">{u.replaced}</td>
                    <td>{u.uploaded_by}</td>
                    <td>
                      <span className={"badge badge--" + (l && l.locked ? "bad" : "mute")}>
                        {l && l.locked ? "잠김" : "열림"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* ══════════════════ 수금계획 다운로드 ══════════════════ */

function CashPlan({ data, dataView, notify }) {
  const planMonths = data.meta.cash_plan_months || [thisMonth()];
  const [month, setMonth] = useState(planMonths[0]);
  const [asOfDate, setAsOfDate] = useState(data.meta.today);
  const [includeOverdue, setIncludeOverdue] = useState(false);
  const [includeBad, setIncludeBad] = useState(false);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch("/tf/ar/api/cash-plan/export", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, as_of_date: asOfDate, data_view: dataView,
          include_overdue: includeOverdue, include_bad: includeBad }),
      });
      if (!res.ok) {
        let message = "수금계획을 생성하지 못했습니다.";
        try { message = (await res.json()).error || message; } catch (e) { /* ignore */ }
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "MedPark_" + Number(month.slice(5, 7)) + "월_수금계획" +
        (includeOverdue ? "_미수포함" : "") + (includeBad ? "_부실포함" : "") + ".xlsx";
      link.click(); URL.revokeObjectURL(url);
      notify(Number(month.slice(5, 7)) + "월 수금계획을 생성했습니다.");
    } catch (e) { notify(e.message, true); }
    setBusy(false);
  }

  return (
    <>
      <Card title="㈜메드파크 자금수지관리 수금계획">
        <div className="formrow">
          <Field label="수금계획 기준월">
            <select className="select" value={month} onChange={(e) => setMonth(e.target.value)}>
              {planMonths.map((m) => <option key={m} value={m}>{Number(m.slice(5, 7))}월 수금계획</option>)}
            </select>
          </Field>
          <Field label="미수채권 조회기준일">
            <input className="input" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          </Field>
        </div>
        <div className="chiprow" style={{ marginTop: 12 }}>
          <label className="chip" aria-pressed={includeOverdue}><input type="checkbox" checked={includeOverdue}
            onChange={(e) => setIncludeOverdue(e.target.checked)} /> 미수채권 포함</label>
          <label className="chip" aria-pressed={includeBad}><input type="checkbox" checked={includeBad}
            onChange={(e) => setIncludeBad(e.target.checked)} /> 부실채권 포함</label>
        </div>
        <div className="alert alert--info" style={{ margin: "12px 0" }}>
          정상채권은 선택한 월의 수금대상 금액만 반영합니다. 미수채권은 입력한 조회기준일 현재 상태로 산정합니다.
        </div>
        <button className="btn btn--primary" onClick={download} disabled={busy || !month || !asOfDate}>
          {busy ? "엑셀 생성 중" : Number(month.slice(5, 7)) + "월 수금계획 다운로드"}
        </button>
      </Card>
      <Card title="적용 기준">
        <ul className="template-steps">
          <li>본부는 <b>사업부</b>, 수금/지출은 <b>수금</b>으로 고정합니다.</li>
          <li>부서/팀과 집행항목은 덴탈·메디컬·에스테틱 사업부에 맞춰 자동 변환합니다.</li>
          <li>자금계획일·자금실행일은 해당 월 말일이며, 수금목표일이 있으면 그 날짜를 사용합니다.</li>
          <li>정상채권·미수채권·부실채권을 거래처별 별도 행으로 표시합니다.</li>
        </ul>
      </Card>
    </>
  );
}

/* ══════════════════ 계정·권한 관리 ══════════════════ */

function Users({ data, notify, refresh }) {
  const [sel, setSel] = useState(null);
  const [perms, setPerms] = useState([]);
  const [role, setRole] = useState("sales");
  const [newUser, setNewUser] = useState({
    username: "", name: "", title: "", role: "sales", biz_unit: "", password: "",
  });
  const setNew = (key) => (e) => setNewUser((v) => ({ ...v, [key]: e.target.value }));

  async function createAccount(e) {
    e.preventDefault();
    if (!newUser.username.trim() || !newUser.name.trim()) {
      notify("아이디와 이름을 입력하세요.", true); return;
    }
    if (newUser.password.length < 8) {
      notify("초기 비밀번호는 8자 이상으로 입력하세요.", true); return;
    }
    try {
      await api("/tf/ar/api/users", { method: "POST", body: newUser });
      notify(newUser.username + " 계정을 등록했습니다.");
      setNewUser({ username: "", name: "", title: "", role: "sales", biz_unit: "", password: "" });
      await refresh();
    } catch (e) { notify(e.message, true); }
  }

  function choose(u) {
    setSel(u.username); setPerms(u.permissions || []); setRole(u.role);
  }
  function applyTemplate(r) {
    setRole(r); setPerms(data.meta.roles[r].perms);
  }
  async function save() {
    try {
      await api("/tf/ar/api/users/" + sel, { method: "PATCH", body: { role, permissions: perms } });
      notify(sel + " 권한을 저장했습니다."); await refresh();
    } catch (e) { notify(e.message, true); }
  }
  async function toggleActive(u) {
    try {
      await api("/tf/ar/api/users/" + u.username, { method: "PATCH", body: { active: !u.active } });
      await refresh();
    } catch (e) { notify(e.message, true); }
  }
  async function resetPassword(u) {
    const pw = prompt(u.username + " 의 새 비밀번호 (8자 이상)");
    if (!pw) return;
    if (pw.length < 8) { notify("8자 이상으로 입력하세요.", true); return; }
    try {
      await api("/tf/ar/api/users/" + u.username, { method: "PATCH", body: { password: pw } });
      notify("비밀번호를 변경했습니다.");
    } catch (e) { notify(e.message, true); }
  }

  return (
    <>
      <Card title="신규 계정 등록">
        <form onSubmit={createAccount}>
          <div className="formrow">
            <Field label="아이디*"><input className="input" value={newUser.username} onChange={setNew("username")} /></Field>
            <Field label="이름*"><input className="input" value={newUser.name} onChange={setNew("name")} /></Field>
            <Field label="직위"><input className="input" value={newUser.title} onChange={setNew("title")} /></Field>
            <Field label="역할"><select className="select" value={newUser.role} onChange={setNew("role")}>
              {Object.entries(data.meta.roles).map(([key, r]) => <option key={key} value={key}>{r.label}</option>)}
            </select></Field>
            <Field label="사업부"><select className="select" value={newUser.biz_unit} onChange={setNew("biz_unit")}>
              <option value="">전체/미지정</option>{data.meta.units.map((u) => <option key={u}>{u}</option>)}
            </select></Field>
            <Field label="초기 비밀번호*"><input className="input" type="password" minLength="8"
              value={newUser.password} onChange={setNew("password")} /></Field>
          </div>
          <button className="btn btn--primary" type="submit">계정 등록</button>
        </form>
      </Card>

      <Card title="계정" flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>아이디</th><th>이름</th><th>직위</th><th>역할</th><th>사업부</th>
                <th className="r">권한 수</th><th>상태</th><th /></tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.username} style={{ background: sel === u.username ? "var(--brand-soft)" : undefined }}>
                  <td className="t-strong">{u.username}</td>
                  <td>{u.name}</td>
                  <td className="t-muted">{u.title || "–"}</td>
                  <td><span className="badge badge--brand">{data.meta.roles[u.role].label}</span></td>
                  <td>{u.biz_unit || "–"}</td>
                  <td className="r num">{(u.permissions || []).length} / {data.meta.permissions.length}</td>
                  <td><span className={"badge badge--" + (u.active ? "ok" : "mute")}>
                    {u.active ? "사용" : "정지"}</span></td>
                  <td className="r">
                    <div className="btnrow" style={{ justifyContent: "flex-end" }}>
                      <button className="btn btn--sm" onClick={() => choose(u)}>권한 편집</button>
                      <button className="btn btn--sm" onClick={() => resetPassword(u)}>비밀번호</button>
                      <button className="btn btn--sm" onClick={() => toggleActive(u)}>
                        {u.active ? "정지" : "사용"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {sel && (
        <Card title={sel + " 권한"}
          actions={<button className="btn btn--sm btn--primary" onClick={save}>변경 저장</button>}>
          <Field label="역할 템플릿">
            <div className="chiprow">
              {Object.entries(data.meta.roles).map(([key, r]) => (
                <button key={key} className="chip" aria-pressed={role === key}
                  onClick={() => applyTemplate(key)}>{r.label}</button>
              ))}
            </div>
          </Field>
          <div className="permgrid" style={{ marginTop: 12 }}>
            {data.meta.permissions.map((p) => (
              <label key={p.key}>
                <input type="checkbox" checked={perms.includes(p.key)}
                  onChange={(e) => setPerms(e.target.checked
                    ? [...perms, p.key] : perms.filter((x) => x !== p.key))} />
                {p.label}
              </label>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

/* ══════════════════ 사용 매뉴얼 ══════════════════ */

function Manual() {
  const steps = [
    ["1", "조회기준 확인", "화면 상단에서 마감 기준 또는 최신 출고 포함 기준을 선택합니다."],
    ["2", "출고자료 반영", "관리자가 출고 데이터를 업로드하고 오류·합계·기준일을 확인합니다."],
    ["3", "거래처 관리", "회수기간·담당자·수금목표일·비고를 입력하고 미입력 거래처를 정리합니다."],
    ["4", "수금 등록·승인", "수금액과 수금일을 등록한 뒤 재무담당자가 승인하여 잔액에 반영합니다."],
    ["5", "현황 보고", "채권요약·결산회의 자료를 확인하고 PPT·PNG·Excel로 내려받습니다."],
  ];
  const menus = [
    ["대시보드", "전체 채권과 전일 수금 확인", "조회기준과 사업부를 먼저 선택"],
    ["채권요약현황", "사업부별 채권·수금 실적 보고", "결산자료는 PPT 또는 PNG 다운로드"],
    ["결산회의 미수채권", "잔액이 있는 미수채권만 회의자료로 확인", "사업부 선택 후 PPT·PNG 다운로드"],
    ["거래처별 현황", "회수기간·담당자·연체기간 조회 및 수정", "회수기간 미입력 필터로 누락 거래처 정리"],
    ["담당자별 채권현황", "담당자별 거래처와 채권잔액 확인", "미배정 거래처를 우선 점검"],
    ["수금 등록", "수금 등록·승인·반려", "거래처·금액·수금일 확인 후 등록"],
    ["수금목표 관리", "예정 수금액과 완료일 관리", "완료 시 실제 수금등록 여부도 확인"],
    ["출고 데이터 업로드", "아마란스 출고자료 반영", "월·출고기준일·합계 확인 후 확정"],
    ["수금계획 다운로드", "선택한 조회기준으로 계획서 생성", "다운로드 전 기준월 확인"],
    ["계정·권한 관리", "사용자 계정과 업무권한 설정", "관리자만 변경하고 퇴사자는 사용 정지"],
  ];
  return <>
    <Card title="처음 사용할 때 · 기본 업무 순서">
      <div className="manual-steps">{steps.map(([no, title, text]) =>
        <div className="manual-step" key={no}><b>{no}</b><span><strong>{title}</strong><small>{text}</small></span></div>)}</div>
    </Card>
    <Card title="메뉴별 사용법" flush>
      <div className="tablewrap"><table className="manual-table">
        <thead><tr><th>메뉴</th><th>주요 기능</th><th>간단 사용법</th></tr></thead>
        <tbody>{menus.map((row) => <tr key={row[0]}><td className="t-strong">{row[0]}</td><td>{row[1]}</td><td>{row[2]}</td></tr>)}</tbody>
      </table></div>
    </Card>
    <Card title="꼭 확인하세요">
      <div className="manual-notices">
        <div><b>조회기준</b><span>보고 화면은 선택한 조회기준을 따르며, 수금·업로드 화면은 항상 최신 운영데이터를 사용합니다.</span></div>
        <div><b>수금 승인</b><span>수금은 등록만으로 잔액이 줄지 않습니다. 재무담당자의 승인 후 반영됩니다.</span></div>
        <div><b>미수 전환</b><span>거래가 종료된 정상채권은 채권 상세에서 미수채권으로 전환할 수 있습니다.</span></div>
        <div><b>권한</b><span>계정 권한에 따라 사용할 수 없는 메뉴는 보이지 않을 수 있습니다.</span></div>
      </div>
    </Card>
  </>;
}

/* ══════════════════ 셸 ══════════════════ */

const SCREENS = [
  { key: "dashboard", label: "대시보드",         perm: "dashboard_view",      group: "현황" },
  { key: "summary",   label: "채권요약현황",     perm: "dashboard_view",      group: "현황" },
  { key: "closing",   label: "결산회의 미수채권", perm: "dashboard_view",      group: "현황" },
  { key: "customers", label: "거래처별 현황",     perm: "customer_view",       group: "현황" },
  { key: "owners",    label: "담당자별 채권현황", perm: "owner_view",          group: "현황" },
  { key: "collections", label: "수금 등록",       perm: "collection_register", group: "수금", alt: "collection_approve" },
  { key: "targets",   label: "수금목표 관리",     perm: "target_manage",       group: "수금" },
  { key: "upload",    label: "출고 데이터 업로드", perm: "upload_data",        group: "관리" },
  { key: "cashplan",  label: "수금계획 다운로드", perm: "data_export",          group: "관리" },
  { key: "users",     label: "계정·권한 관리",    perm: "user_manage",         group: "관리" },
  { key: "manual",    label: "사용 매뉴얼",       perm: null,                  group: "도움말" },
];
const REPORT_SCREENS = new Set(["dashboard", "summary", "closing", "customers", "owners", "targets", "cashplan"]);

function App() {
  const [user, setUser] = useState(undefined);
  const [data, setData] = useState(null);
  const [screen, setScreen] = useState("dashboard");
  const [preset, setPreset] = useState(null);
  const [toast, setToast] = useState(null);
  const [dataView, setDataView] = useState(() => localStorage.getItem("ar_data_view") || "combined");

  const notify = useCallback((message, bad) => {
    setToast({ message, bad });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    const d = await api("/tf/ar/api/bootstrap");
    setData(d); setUser(d.user);
  }, []);

  useEffect(() => {
    api("/tf/ar/api/me").then((r) => {
      if (r.user) load().catch((e) => notify(e.message, true));
      else setUser(null);
    }).catch(() => setUser(null));
  }, [load, notify]);

  const can = useCallback((perm) => !!(user && user.permissions.includes(perm)), [user]);

  const visible = useMemo(
    () => SCREENS.filter((s) => !s.perm || can(s.perm) || (s.alt && can(s.alt))), [can]);

  useEffect(() => {
    if (visible.length && !visible.some((s) => s.key === screen)) setScreen(visible[0].key);
  }, [visible, screen]);

  useEffect(() => {
    if (!data) return;
    const options = data.meta.dashboard_views || [];
    if (!options.some((view) => view.key === dataView)) {
      const fallback = options.some((view) => view.key === "combined") ? "combined" : (options[0] && options[0].key);
      if (fallback) setDataView(fallback);
    }
  }, [data, dataView]);

  useEffect(() => { localStorage.setItem("ar_data_view", dataView); }, [dataView]);

  if (user === undefined) {
    return <div className="boot"><div className="boot__mark">MP</div>
      <p className="boot__text">불러오는 중입니다.</p></div>;
  }
  if (user === null) return <Login onDone={() => load()} />;
  if (!data) return <div className="boot"><div className="boot__mark">MP</div>
    <p className="boot__text">데이터를 준비하고 있습니다.</p></div>;

  const patchCustomer = (c) => setData((d) => ({
    ...d, customers: d.customers.map((x) => (x.code === c.code ? { ...x, ...c } : x)),
  }));
  const applyUpload = (res) => setData((d) => ({
    ...d, customers: res.customers, uploads: res.uploads,
  }));

  const current = SCREENS.find((s) => s.key === screen) || SCREENS[0];
  const viewOptions = data.meta.dashboard_views || [{ key: "combined", label: data.meta.reflection_label }];
  const reportScreen = REPORT_SCREENS.has(screen);
  const selectedView = viewOptions.find((view) => view.key === dataView) || viewOptions[0];
  const effectiveView = selectedView.key;
  const reportData = effectiveView === "closing"
    ? { ...data, customers: data.dashboard_closing_customers || data.customers }
    : data;
  const screenData = reportScreen ? reportData : data;
  const groups = [...new Set(visible.map((s) => s.group))];
  const pendingCount = data.collections.filter((c) => c.state === "pending").length;

  async function signOut() {
    await api("/tf/ar/api/logout", { method: "POST" });
    setUser(null); setData(null);
  }

  return (
    <div className="shell">
      <nav className="side">
        <div className="side__top">
          <div className="side__logo"><span>MP</span>채권관리</div>
        </div>
        <div className="side__nav">
          {groups.map((g) => (
            <div key={g}>
              <div className="side__group">{g}</div>
              {visible.filter((s) => s.group === g).map((s) => (
                <button key={s.key} className="side__item" aria-current={screen === s.key}
                  onClick={() => { setPreset(null); setScreen(s.key); }}>
                  {s.label}
                  {s.key === "collections" && pendingCount > 0 && <small>{pendingCount}</small>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="side__foot">기준일 {data.meta.today}</div>
      </nav>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{current.label}</h1>
            <div className="sub">기준일 {data.meta.today} · {reportScreen ? selectedView.label : "현재 운영데이터 기준"}</div>
            <div className="sub">거래처 {screenData.customers.length}곳 · 전체 채권 {won(sum(screenData.customers, "balance"))}원</div>
          </div>
          <div className="spacer" />
          {reportScreen ? <label className="view-select">
            <span>조회기준</span>
            <select className="select" value={effectiveView} onChange={(e) => setDataView(e.target.value)}>
              {viewOptions.map((view) => <option key={view.key} value={view.key}>{view.label}</option>)}
            </select>
          </label> : <span className="badge badge--brand">현재 운영데이터 기준</span>}
          <div className="who">
            <b>{user.name}{user.title && " " + user.title}</b>
            <span>{data.meta.roles[user.role].label} · {user.username}</span>
          </div>
          <button className="btn btn--sm" onClick={signOut}>로그아웃</button>
        </header>

        <div className="page">
          {screen === "dashboard" && <Dashboard data={reportData} setScreen={setScreen} setPreset={setPreset} />}
          {screen === "summary" && <BondSummary data={reportData} notify={notify} />}
          {screen === "closing" && <ClosingReceivables data={reportData} notify={notify} />}
          {screen === "customers" && <Customers data={reportData} can={can} preset={preset}
            notify={notify} patchCustomer={patchCustomer} />}
          {screen === "owners" && <Owners data={reportData} />}
          {screen === "collections" && <Collections data={data} can={can} notify={notify} refresh={load} />}
          {screen === "targets" && <Targets data={reportData} notify={notify} refresh={load} />}
          {screen === "upload" && <Upload data={data} can={can} notify={notify}
            applyUpload={applyUpload} refresh={load} />}
          {screen === "cashplan" && <CashPlan data={reportData} dataView={effectiveView} notify={notify} />}
          {screen === "users" && <Users data={data} notify={notify} refresh={load} />}
          {screen === "manual" && <Manual />}
        </div>
      </main>

      {toast && <div className={"toast" + (toast.bad ? " toast--bad" : "")}>{toast.message}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
