const {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback
} = React;

/* ══════════════════ 유틸 ══════════════════ */

const won = n => (Number(n) || 0).toLocaleString("ko-KR");
const amountNumber = value => Number(String(value || "").replace(/[^0-9]/g, "")) || 0;
const formatAmountInput = value => {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  return digits ? Number(digits).toLocaleString("ko-KR") : "";
};
function koreanAmountUnit(value) {
  let amount = amountNumber(value);
  if (!amount) return "";
  const parts = [];
  const eok = Math.floor(amount / 100000000);
  if (eok) {
    parts.push(won(eok) + "억");
    amount %= 100000000;
  }
  const man = Math.floor(amount / 10000);
  if (man) {
    parts.push(won(man) + "만");
    amount %= 10000;
  }
  if (amount) parts.push(won(amount));
  return parts.join(" ") + "원";
}
function short(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e8) return {
    value: (v / 1e8).toFixed(1),
    unit: "억"
  };
  if (Math.abs(v) >= 1e4) return {
    value: Math.round(v / 1e4).toLocaleString("ko-KR"),
    unit: "만"
  };
  return {
    value: v.toLocaleString("ko-KR"),
    unit: "원"
  };
}
const STATUS_STYLE = {
  정상: "ok",
  연체: "warn",
  부실: "bad"
};
const STATUS_LABEL = {
  정상: "정상채권",
  연체: "미수채권",
  부실: "부실채권"
};
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);
const sum = (list, key) => list.reduce((a, x) => a + (Number(x[key]) || 0), 0);
function customerForUnit(customer, unit) {
  if (unit === "전체") return customer;
  const part = customer.unit_breakdown && customer.unit_breakdown[unit];
  if (!part) return null;
  return {
    ...customer,
    ...part,
    biz_unit: unit,
    status: Number(part.bad_balance) ? "부실" : Number(part.overdue_balance) ? "연체" : "정상"
  };
}
function customersForUnit(customers, unit) {
  return unit === "전체" ? customers : customers.map(c => customerForUnit(c, unit)).filter(Boolean);
}
const code5 = code => String(code || "").padStart(5, "0");
const overdueMonths = days => Math.ceil(Math.max(0, Number(days) || 0) / 30);
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: options.body ? {
      "Content-Type": "application/json"
    } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {/* 본문 없음 */}
  if (!res.ok) throw new Error(data.error || "요청을 처리하지 못했습니다. (" + res.status + ")");
  return data;
}

/* ══════════════════ 공용 컴포넌트 ══════════════════ */

function Card({
  title,
  actions,
  children,
  flush
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "card"
  }, (title || actions) && /*#__PURE__*/React.createElement("header", {
    className: "card__head"
  }, /*#__PURE__*/React.createElement("h3", null, title), /*#__PURE__*/React.createElement("div", {
    className: "spacer"
  }), actions), /*#__PURE__*/React.createElement("div", {
    className: "card__body" + (flush ? " card__body--flush" : "")
  }, children));
}
function Empty({
  title,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, /*#__PURE__*/React.createElement("b", null, title), children);
}
function Badge({
  status
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "badge badge--" + (STATUS_STYLE[status] || "mute")
  }, STATUS_LABEL[status] || status);
}
function Field({
  label,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, label), children);
}

/* ══════════════════ 로그인 ══════════════════ */

function Login({
  onDone
}) {
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
    setBusy(true);
    setError("");
    try {
      const {
        user
      } = await api("/tf/ar/api/login", {
        method: "POST",
        body: {
          username: loginUsername,
          password: loginPassword
        }
      });
      onDone(user);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "login"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "login__aside"
  }, /*#__PURE__*/React.createElement("div", {
    className: "login__brand"
  }, "MEDPARK"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "login__head"
  }, "미수채권", /*#__PURE__*/React.createElement("br", null), "관리 시스템"), /*#__PURE__*/React.createElement("p", {
    className: "login__sub"
  }, "덴탈·메디컬·에스테틱 세 사업부의 채권 잔액과 수금 진행을 한 화면에서 봅니다."), /*#__PURE__*/React.createElement("div", {
    className: "login__stat"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "3"), "사업부"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "9"), "채권 분류"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "11"), "권한 구분"))), /*#__PURE__*/React.createElement("div", {
    className: "login__brand",
    style: {
      opacity: .55
    }
  }, "내부 업무용 · 외부 공유 금지")), /*#__PURE__*/React.createElement("div", {
    className: "login__panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "login__form"
  }, /*#__PURE__*/React.createElement("h2", null, "로그인"), /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "회사에서 발급받은 계정으로 접속하세요."), error && /*#__PURE__*/React.createElement("div", {
    className: "alert alert--bad"
  }, error), /*#__PURE__*/React.createElement(Field, {
    label: "아이디"
  }, /*#__PURE__*/React.createElement("input", {
    ref: usernameRef,
    className: "input",
    value: username,
    autoFocus: true,
    autoComplete: "username",
    onChange: e => setUsername(e.target.value),
    onInput: e => setUsername(e.target.value),
    onKeyDown: e => e.key === "Enter" && submit(),
    placeholder: "Medpark0"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "비밀번호"
  }, /*#__PURE__*/React.createElement("input", {
    ref: passwordRef,
    className: "input",
    type: "password",
    value: password,
    autoComplete: "current-password",
    onChange: e => setPassword(e.target.value),
    onInput: e => setPassword(e.target.value),
    onKeyDown: e => e.key === "Enter" && submit()
  })), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--primary",
    style: {
      width: "100%",
      marginTop: 6
    },
    onClick: submit,
    disabled: busy
  }, busy ? "확인하는 중" : "로그인"))));
}

/* ══════════════════ 대시보드 ══════════════════ */

function Dashboard({
  data,
  setScreen,
  setPreset
}) {
  const {
    collections,
    targets
  } = data;
  const customers = data.customers;
  const [unit, setUnit] = useState("전체");
  const [normalTopUnit, setNormalTopUnit] = useState("전체");
  const [overdueTopUnit, setOverdueTopUnit] = useState("전체");
  const scoped = useMemo(() => customersForUnit(customers, unit), [customers, unit]);
  const totals = useMemo(() => {
    const by = {
      정상: sum(scoped, "normal_balance"),
      연체: sum(scoped, "overdue_balance"),
      부실: sum(scoped, "bad_balance")
    };
    const cnt = {
      정상: scoped.filter(c => c.normal_balance !== 0).length,
      연체: scoped.filter(c => c.overdue_balance !== 0).length,
      부실: scoped.filter(c => c.bad_balance !== 0).length
    };
    return {
      by,
      cnt,
      all: sum(scoped, "balance")
    };
  }, [scoped]);
  const byUnit = useMemo(() => data.meta.units.map(u => {
    const rows = customersForUnit(customers, u);
    const g = {
      unit: u,
      정상: 0,
      연체: 0,
      부실: 0,
      count: rows.length
    };
    rows.forEach(c => {
      g.정상 += Number(c.normal_balance) || 0;
      g.연체 += Number(c.overdue_balance) || 0;
      g.부실 += Number(c.bad_balance) || 0;
    });
    g.total = g.정상 + g.연체 + g.부실;
    return g;
  }), [customers, data.meta.units]);
  const approved = collections.filter(c => c.state === "approved");
  const monthly = useMemo(() => {
    const map = {};
    approved.forEach(c => {
      const m = (c.paid_at || "").slice(0, 7);
      if (!m) return;
      map[m] = map[m] || {
        month: m,
        amount: 0,
        count: 0
      };
      map[m].amount += c.amount;
      map[m].count += 1;
    });
    return Object.values(map).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 6);
  }, [approved]);
  const normalTop5 = customersForUnit(customers, normalTopUnit).filter(c => c.normal_balance > 0).sort((a, b) => b.normal_balance - a.normal_balance).slice(0, 5);
  const overdueTop5 = customersForUnit(customers, overdueTopUnit).filter(c => c.overdue_balance > 0).sort((a, b) => b.overdue_balance - a.overdue_balance).slice(0, 5);
  const topUnitSelect = (value, setter, label) => /*#__PURE__*/React.createElement("select", {
    className: "select",
    style: {
      width: 110,
      padding: "6px 9px"
    },
    value: value,
    onChange: e => setter(e.target.value),
    "aria-label": label
  }, ["전체", ...data.meta.units].map(u => /*#__PURE__*/React.createElement("option", {
    key: u,
    value: u
  }, u)));
  const todayStr = today();
  const weekEnd = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const openTargets = targets.filter(t => t.state !== "done");
  const dueToday = openTargets.filter(t => t.target_date === todayStr);
  const dueWeek = openTargets.filter(t => t.target_date > todayStr && t.target_date <= weekEnd);
  const overdueTargets = openTargets.filter(t => t.target_date < todayStr);
  const owners = useMemo(() => {
    const map = {};
    scoped.forEach(c => {
      const key = c.owner || "미지정";
      map[key] = map[key] || {
        owner: key,
        정상: 0,
        연체: 0,
        부실: 0,
        total: 0,
        count: 0
      };
      map[key].정상 += c.normal_balance;
      map[key].연체 += c.overdue_balance;
      map[key].부실 += c.bad_balance;
      map[key].total += c.balance;
      map[key].count += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [scoped]);
  const jump = status => {
    setPreset({
      status,
      unit
    });
    setScreen("customers");
  };
  const maxUnit = Math.max(1, ...byUnit.map(g => g.total));
  const kpis = [{
    key: "전체",
    label: "전체 채권 잔액",
    value: totals.all,
    count: scoped.length,
    color: "var(--brand)"
  }, {
    key: "정상",
    label: "정상채권 잔액",
    value: totals.by.정상,
    count: totals.cnt.정상,
    color: "var(--ok)"
  }, {
    key: "연체",
    label: "미수채권(11개월 내) 잔액",
    value: totals.by.연체,
    count: totals.cnt.연체,
    color: "var(--warn)"
  }, {
    key: "부실",
    label: "부실채권(12개월 이상)",
    value: totals.by.부실,
    count: totals.cnt.부실,
    color: "var(--bad)"
  }];
  // 정오 UTC를 기준으로 계산하면 한국 브라우저에서도 날짜가 하루 더 밀리지 않는다.
  const yesterdayDate = new Date(data.meta.today + "T12:00:00Z");
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  const customerUnit = Object.fromEntries(customers.map(c => [c.code, c.biz_unit]));
  const yesterdayCollections = approved.filter(c => c.paid_at === yesterday);
  const yesterdayCustomers = Object.values(yesterdayCollections.reduce((map, c) => {
    const key = c.customer_code || c.customer_name;
    if (!map[key]) map[key] = {
      name: c.customer_name || key,
      amount: 0
    };
    map[key].amount += Number(c.amount) || 0;
    return map;
  }, {})).sort((a, b) => b.amount - a.amount);
  const yesterdayByUnit = data.meta.units.map(u => ({
    unit: u,
    amount: sum(yesterdayCollections.filter(c => customerUnit[c.customer_code] === u), "amount")
  }));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "chiprow"
  }, ["전체", ...data.meta.units].map(u => /*#__PURE__*/React.createElement("button", {
    key: u,
    className: "chip",
    "aria-pressed": unit === u,
    onClick: () => setUnit(u)
  }, u))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid--kpi"
  }, kpis.map(k => {
    const s = short(k.value);
    return /*#__PURE__*/React.createElement("button", {
      key: k.key,
      className: "kpi",
      onClick: () => k.key !== "전체" && jump(k.key)
    }, /*#__PURE__*/React.createElement("div", {
      className: "kpi__label"
    }, /*#__PURE__*/React.createElement("i", {
      className: "kpi__dot",
      style: {
        background: k.color
      }
    }), k.label), /*#__PURE__*/React.createElement("div", {
      className: "kpi__value num"
    }, s.value, /*#__PURE__*/React.createElement("em", null, s.unit)), /*#__PURE__*/React.createElement("div", {
      className: "kpi__meta num"
    }, "거래처 ", k.count, "곳 · ", won(k.value), "원"));
  })), /*#__PURE__*/React.createElement(Card, {
    title: "전일 수금현황 요약 · " + yesterday
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid--3"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "kpi__label"
  }, "승인 수금 합계"), /*#__PURE__*/React.createElement("div", {
    className: "kpi__value num"
  }, won(sum(yesterdayCollections, "amount")), /*#__PURE__*/React.createElement("em", null, "원"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "kpi__label"
  }, "승인 건수"), /*#__PURE__*/React.createElement("div", {
    className: "kpi__value num"
  }, yesterdayCollections.length, /*#__PURE__*/React.createElement("em", null, "건")), /*#__PURE__*/React.createElement("div", {
    className: "t-sm t-muted",
    style: {
      marginTop: 4
    }
  }, yesterdayCustomers.length ? /*#__PURE__*/React.createElement(React.Fragment, null, yesterdayCustomers.slice(0, 3).map(c => c.name).join(" · "), yesterdayCustomers.length > 3 ? " 외 " + (yesterdayCustomers.length - 3) + "개처" : "") : "수금 내역 없음")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "kpi__label"
  }, "사업부별 수금"), /*#__PURE__*/React.createElement("div", {
    className: "t-sm"
  }, yesterdayByUnit.map(r => /*#__PURE__*/React.createElement("span", {
    key: r.unit,
    style: {
      display: "block",
      marginTop: 3
    }
  }, r.unit, " · ", /*#__PURE__*/React.createElement("b", {
    className: "num"
  }, won(r.amount), "원"))))))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid--2"
  }, /*#__PURE__*/React.createElement(Card, {
    title: "사업부별 채권 분류 현황",
    actions: /*#__PURE__*/React.createElement("div", {
      className: "legend"
    }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("i", {
      style: {
        background: "var(--ok)"
      }
    }), "정상채권"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("i", {
      style: {
        background: "var(--warn)"
      }
    }), "미수채권"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("i", {
      style: {
        background: "var(--bad)"
      }
    }), "부실채권"))
  }, /*#__PURE__*/React.createElement("div", {
    className: "signal"
  }, byUnit.map(g => /*#__PURE__*/React.createElement("div", {
    className: "signal__row",
    key: g.unit
  }, /*#__PURE__*/React.createElement("div", {
    className: "signal__unit"
  }, g.unit), /*#__PURE__*/React.createElement("div", {
    className: "signal__bar",
    style: {
      width: Math.max(8, g.total / maxUnit * 100) + "%"
    }
  }, ["정상", "연체", "부실"].map(s => g[s] > 0 && /*#__PURE__*/React.createElement("button", {
    key: s,
    className: "signal__seg signal__seg--" + STATUS_STYLE[s],
    style: {
      width: g[s] / g.total * 100 + "%"
    },
    title: g.unit + " " + STATUS_LABEL[s] + " " + won(g[s]) + "원",
    onClick: () => {
      setPreset({
        status: s,
        unit: g.unit
      });
      setScreen("customers");
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "signal__total num"
  }, short(g.total).value, short(g.total).unit)))), /*#__PURE__*/React.createElement("p", {
    className: "t-sm t-muted",
    style: {
      margin: "14px 0 0"
    }
  }, "막대를 누르면 해당 사업부·분류의 거래처 목록으로 이동합니다.")), /*#__PURE__*/React.createElement(Card, {
    title: "월별 수금 실적",
    flush: true
  }, monthly.length === 0 ? /*#__PURE__*/React.createElement(Empty, {
    title: "승인된 수금 내역이 아직 없습니다."
  }, "수금 등록 화면에서 입력하고 재무담당이 승인하면 여기에 집계됩니다.") : /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "기준월"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "건수"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "수금액 (원)"))), /*#__PURE__*/React.createElement("tbody", null, monthly.map(m => /*#__PURE__*/React.createElement("tr", {
    key: m.month
  }, /*#__PURE__*/React.createElement("td", {
    className: "t-strong num"
  }, m.month), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, m.count), /*#__PURE__*/React.createElement("td", {
    className: "r num t-strong"
  }, won(m.amount))))), /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "합계"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, sum(monthly, "count")), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(sum(monthly, "amount"))))))))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid--3"
  }, /*#__PURE__*/React.createElement(Card, {
    title: "수금목표 요약"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "구분"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "건수"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "목표금액 (원)"))), /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "오늘 목표"), /*#__PURE__*/React.createElement("td", {
    className: "r num t-strong"
  }, dueToday.length), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(sum(dueToday, "amount")))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "이번 주 목표"), /*#__PURE__*/React.createElement("td", {
    className: "r num t-strong"
  }, dueWeek.length), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(sum(dueWeek, "amount")))), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "기한 초과"), /*#__PURE__*/React.createElement("td", {
    className: "r num t-strong",
    style: {
      color: overdueTargets.length ? "var(--bad)" : "inherit"
    }
  }, overdueTargets.length), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(sum(overdueTargets, "amount")))))), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm",
    style: {
      marginTop: 12
    },
    onClick: () => setScreen("targets")
  }, "수금목표 관리로 이동")), /*#__PURE__*/React.createElement(Card, {
    title: "정상채권 TOP 5",
    actions: topUnitSelect(normalTopUnit, setNormalTopUnit, "정상채권 사업부 선택"),
    flush: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("tbody", null, normalTop5.map((c, i) => /*#__PURE__*/React.createElement("tr", {
    key: c.code
  }, /*#__PURE__*/React.createElement("td", {
    className: "t-muted num",
    style: {
      width: 26
    }
  }, i + 1), /*#__PURE__*/React.createElement("td", {
    className: "t-strong"
  }, c.name), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Badge, {
    status: "정상"
  })), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(c.normal_balance)))), normalTop5.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    className: "t-muted"
  }, "정상채권 데이터가 없습니다.")))))), /*#__PURE__*/React.createElement(Card, {
    title: "미수채권 TOP 5",
    actions: topUnitSelect(overdueTopUnit, setOverdueTopUnit, "미수채권 사업부 선택"),
    flush: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("tbody", null, overdueTop5.map((c, i) => /*#__PURE__*/React.createElement("tr", {
    key: c.code
  }, /*#__PURE__*/React.createElement("td", {
    className: "t-muted num",
    style: {
      width: 26
    }
  }, i + 1), /*#__PURE__*/React.createElement("td", {
    className: "t-strong"
  }, c.name), /*#__PURE__*/React.createElement("td", {
    className: "num t-sm t-muted"
  }, overdueMonths(c.overdue_days), "개월"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(c.overdue_balance)))), overdueTop5.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    className: "t-muted"
  }, "미수채권 데이터가 없습니다."))))))), /*#__PURE__*/React.createElement(Card, {
    title: "담당자별 채권 현황",
    flush: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "담당자"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "거래처"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "정상채권"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "미수채권"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "부실채권"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "합계"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 150
    }
  }, "미수·부실채권 비중"))), /*#__PURE__*/React.createElement("tbody", null, owners.map(o => {
    const risk = o.total ? (o.연체 + o.부실) / o.total * 100 : 0;
    return /*#__PURE__*/React.createElement("tr", {
      key: o.owner
    }, /*#__PURE__*/React.createElement("td", {
      className: "t-strong"
    }, o.owner), /*#__PURE__*/React.createElement("td", {
      className: "r num"
    }, o.count), /*#__PURE__*/React.createElement("td", {
      className: "r num"
    }, won(o.정상)), /*#__PURE__*/React.createElement("td", {
      className: "r num"
    }, won(o.연체)), /*#__PURE__*/React.createElement("td", {
      className: "r num"
    }, won(o.부실)), /*#__PURE__*/React.createElement("td", {
      className: "r num t-strong"
    }, won(o.total)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "bar"
    }, /*#__PURE__*/React.createElement("i", {
      style: {
        width: risk + "%",
        background: risk > 40 ? "var(--bad)" : risk > 15 ? "var(--warn)" : "var(--ok)"
      }
    })), /*#__PURE__*/React.createElement("span", {
      className: "t-sm num t-muted"
    }, risk.toFixed(0), "%"))));
  }))))));
}

/* ══════════════════ 채권요약현황 ══════════════════ */

function BondSummary({
  data,
  notify
}) {
  const reportRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const unitNames = {
    덴탈: "국내덴탈",
    메디컬: "국내메디컬",
    에스테틱: "국내에스테틱"
  };
  const units = data.meta.units;
  function liveNormal(c) {
    const source = {
      later: Number(c.normal_later_balance) || 0,
      next: Number(c.normal_next_balance) || 0,
      current: Number(c.normal_current_balance) || 0
    };
    let paid = Math.max(0, source.later + source.next + source.current - (Number(c.normal_balance) || 0));
    const current = Math.max(0, source.current - paid);
    paid = Math.max(0, paid - source.current);
    const next = Math.max(0, source.next - paid);
    paid = Math.max(0, paid - source.next);
    const later = Math.max(0, source.later - paid);
    return {
      later,
      next,
      current
    };
  }
  const summary = useMemo(() => units.map(unit => {
    const customers = customersForUnit(data.customers, unit);
    const row = {
      unit,
      later: 0,
      next: 0,
      current: 0,
      overdue: 0,
      bad: 0,
      normalCollected: 0,
      overdueCollected: 0
    };
    customers.forEach(c => {
      const live = liveNormal(c);
      row.later += live.later;
      row.next += live.next;
      row.current += live.current;
      row.overdue += Number(c.overdue_balance) || 0;
      row.bad += Number(c.bad_balance) || 0;
      const normalSource = (Number(c.normal_later_balance) || 0) + (Number(c.normal_next_balance) || 0) + (Number(c.normal_current_balance) || 0);
      row.normalCollected += (Number(c.normal_collected) || 0) + Math.max(0, normalSource - (Number(c.normal_balance) || 0));
      row.overdueCollected += (Number(c.overdue_collected) || 0) + Math.max(0, (Number(c.overdue_source_balance) || 0) - (Number(c.overdue_balance) || 0));
    });
    row.normal = row.later + row.next + row.current;
    row.total = row.normal + row.overdue + row.bad;
    return row;
  }), [data.customers, units]);
  const total = key => sum(summary, key);
  const rate = (value, base) => base ? (value / base * 100).toFixed(1) + "%" : "0.0%";
  const sourceMonth = data.uploads[0] && data.uploads[0].month || thisMonth();
  const reportDate = data.meta.today || today();
  const reportMonth = Number(reportDate.slice(5, 7));
  const reportDay = Number(reportDate.slice(8, 10));
  async function exportReport(kind) {
    setExporting(true);
    try {
      if (!window.html2canvas) throw new Error("이미지 변환 모듈을 불러오지 못했습니다.");
      const canvas = await window.html2canvas(reportRef.current, {
        scale: 2,
        backgroundColor: "#eef1f6",
        useCORS: true
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
        slide.background = {
          color: "EEF1F6"
        };
        slide.addText("㈜메드파크 채권요약현황", {
          x: .35,
          y: .12,
          w: 8,
          h: .34,
          fontFace: "Pretendard",
          fontSize: 17,
          bold: true,
          color: "16202E"
        });
        slide.addText("기준일 " + data.meta.today, {
          x: 10.2,
          y: .18,
          w: 2.75,
          h: .22,
          align: "right",
          fontFace: "Pretendard",
          fontSize: 9,
          color: "5C6B80"
        });
        const ratio = Math.min(12.65 / canvas.width, 6.8 / canvas.height);
        slide.addImage({
          data: canvas.toDataURL("image/png"),
          x: .34,
          y: .52,
          w: canvas.width * ratio,
          h: canvas.height * ratio
        });
        await pptx.writeFile({
          fileName: base + ".pptx"
        });
      }
      notify((kind === "png" ? "그림파일" : "PPT") + " 다운로드를 시작했습니다.");
    } catch (e) {
      notify(e.message, true);
    } finally {
      setExporting(false);
    }
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "export-actions"
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-muted t-sm"
  }, "결산회의용 다운로드"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm",
    disabled: exporting,
    onClick: () => exportReport("png")
  }, "그림파일(PNG)"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm btn--primary",
    disabled: exporting,
    onClick: () => exportReport("pptx")
  }, "PPT")), /*#__PURE__*/React.createElement("div", {
    ref: reportRef,
    className: "summary-export"
  }, /*#__PURE__*/React.createElement(Card, {
    title: "1. 사업부별 채권 분류 현황 (" + reportDate + " 기준)",
    flush: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "tablewrap summary-table"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    rowSpan: "2"
  }, "사업부"), /*#__PURE__*/React.createElement("th", {
    colSpan: "4",
    className: "summary-head summary-head--normal"
  }, "정상채권"), /*#__PURE__*/React.createElement("th", {
    rowSpan: "2",
    className: "summary-head summary-head--overdue"
  }, "미수채권"), /*#__PURE__*/React.createElement("th", {
    rowSpan: "2",
    className: "summary-head summary-head--bad"
  }, "부실채권"), /*#__PURE__*/React.createElement("th", {
    rowSpan: "2",
    className: "summary-head summary-head--total"
  }, "합계"), /*#__PURE__*/React.createElement("th", {
    rowSpan: "2",
    className: "summary-head summary-head--total"
  }, "미수채권 비중")), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "10월 이후"), /*#__PURE__*/React.createElement("th", null, "9월 분"), /*#__PURE__*/React.createElement("th", null, "8월 분(당월)"), /*#__PURE__*/React.createElement("th", null, "[소계]"))), /*#__PURE__*/React.createElement("tbody", null, summary.map(r => /*#__PURE__*/React.createElement("tr", {
    key: r.unit
  }, /*#__PURE__*/React.createElement("td", {
    className: "t-strong"
  }, unitNames[r.unit]), /*#__PURE__*/React.createElement("td", {
    className: "r num summary-normal"
  }, won(r.later)), /*#__PURE__*/React.createElement("td", {
    className: "r num summary-normal"
  }, won(r.next)), /*#__PURE__*/React.createElement("td", {
    className: "r num summary-normal"
  }, won(r.current)), /*#__PURE__*/React.createElement("td", {
    className: "r num summary-subtotal"
  }, won(r.normal)), /*#__PURE__*/React.createElement("td", {
    className: "r num summary-overdue"
  }, won(r.overdue)), /*#__PURE__*/React.createElement("td", {
    className: "r num summary-bad"
  }, won(r.bad)), /*#__PURE__*/React.createElement("td", {
    className: "r num t-strong"
  }, won(r.total)), /*#__PURE__*/React.createElement("td", {
    className: "r num t-strong"
  }, rate(r.overdue, r.total))))), /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "합계"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(total("later"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(total("next"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(total("current"))), /*#__PURE__*/React.createElement("td", {
    className: "r num summary-subtotal"
  }, won(total("normal"))), /*#__PURE__*/React.createElement("td", {
    className: "r num summary-overdue"
  }, won(total("overdue"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(total("bad"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(total("total"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, rate(total("overdue"), total("total"))))))), /*#__PURE__*/React.createElement("div", {
    className: "summary-note",
    "data-html2canvas-ignore": "true"
  }, "현재 운영 기초자료 ", data.customers.length, "개 거래처 기준 · 금액 단위: 원")), /*#__PURE__*/React.createElement(Card, {
    title: "2. " + reportMonth + "월 수금실적 (" + reportMonth + "월 1일 기초 대비, " + reportMonth + "월 " + reportDay + "일 누계)",
    flush: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "tablewrap summary-table"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    rowSpan: "2"
  }, "사업부"), /*#__PURE__*/React.createElement("th", {
    colSpan: "4",
    className: "summary-head summary-head--normal"
  }, "정상채권 (당월분)"), /*#__PURE__*/React.createElement("th", {
    colSpan: "4",
    className: "summary-head summary-head--overdue"
  }, "미수채권 (부실채권 제외)")), /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "기초"), /*#__PURE__*/React.createElement("th", null, "수금액"), /*#__PURE__*/React.createElement("th", null, "잔액"), /*#__PURE__*/React.createElement("th", null, "회수율"), /*#__PURE__*/React.createElement("th", null, "기초"), /*#__PURE__*/React.createElement("th", null, "수금액"), /*#__PURE__*/React.createElement("th", null, "잔액"), /*#__PURE__*/React.createElement("th", null, "회수율"))), /*#__PURE__*/React.createElement("tbody", null, summary.map(r => {
    const normalOpening = r.current + r.normalCollected;
    const overdueOpening = r.overdue + r.overdueCollected;
    return /*#__PURE__*/React.createElement("tr", {
      key: r.unit
    }, /*#__PURE__*/React.createElement("td", {
      className: "t-strong"
    }, unitNames[r.unit]), /*#__PURE__*/React.createElement("td", {
      className: "r num"
    }, won(normalOpening)), /*#__PURE__*/React.createElement("td", {
      className: "r num summary-normal"
    }, won(r.normalCollected)), /*#__PURE__*/React.createElement("td", {
      className: "r num summary-subtotal"
    }, won(r.current)), /*#__PURE__*/React.createElement("td", {
      className: "r num t-strong"
    }, rate(r.normalCollected, normalOpening)), /*#__PURE__*/React.createElement("td", {
      className: "r num"
    }, won(overdueOpening)), /*#__PURE__*/React.createElement("td", {
      className: "r num summary-overdue"
    }, won(r.overdueCollected)), /*#__PURE__*/React.createElement("td", {
      className: "r num summary-subtotal"
    }, won(r.overdue)), /*#__PURE__*/React.createElement("td", {
      className: "r num t-strong"
    }, rate(r.overdueCollected, overdueOpening)));
  })), /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "합계"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(total("current") + total("normalCollected"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(total("normalCollected"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(total("current"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, rate(total("normalCollected"), total("current") + total("normalCollected"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(total("overdue") + total("overdueCollected"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(total("overdueCollected"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(total("overdue"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, rate(total("overdueCollected"), total("overdue") + total("overdueCollected"))))))))));
}

/* ═══════════════ 결산회의용 부서별 미수채권현황 ═══════════════ */

function ClosingReceivables({
  data,
  notify
}) {
  const [unit, setUnit] = useState("전체");
  const reportRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const unitNames = {
    덴탈: "국내덴탈",
    메디컬: "국내메디컬",
    에스테틱: "국내에스테틱"
  };
  const units = unit === "전체" ? data.meta.units : [unit];
  const reports = useMemo(() => units.map(bizUnit => {
    const customers = customersForUnit(data.customers, bizUnit);
    const rawDetail = customers.flatMap(c => {
      const notes = [c.note, ...(c.detail_notes || [])].filter(Boolean);
      return [{
        ...c,
        category: "미수채권",
        amount: Number(c.overdue_balance) || 0,
        months: overdueMonths(c.overdue_days),
        notes
      }].filter(row => row.amount > 0);
    }).sort((a, b) => b.amount - a.amount);
    let detail = rawDetail;
    if (bizUnit === "에스테틱") {
      const small = rawDetail.filter(row => row.amount <= 110000);
      const regular = rawDetail.filter(row => row.amount > 110000);
      if (small.length) {
        const representative = small[0];
        detail = [...regular, {
          ...representative,
          code: "esthetic-small-group",
          name: representative.name + (small.length > 1 ? " 외 " + (small.length - 1) + "개처" : ""),
          amount: sum(small, "amount"),
          period: null,
          months: Math.max(...small.map(row => row.months)),
          notes: [...new Set(small.flatMap(row => row.notes))],
          grouped: true
        }];
      }
    }
    const overdueBalance = sum(customers, "overdue_balance");
    const overdueCollected = sum(customers, "overdue_collected");
    const overdueOpening = overdueBalance + overdueCollected;
    const normalBalance = sum(customers, "normal_balance");
    const normalCollected = sum(customers, "normal_collected");
    return {
      unit: bizUnit,
      customers,
      detail,
      overdueBalance,
      overdueCollected,
      overdueOpening,
      normalBalance,
      normalCollected,
      normalOpening: normalBalance + normalCollected
    };
  }).filter(report => report.overdueBalance > 0), [data.customers, units.join("|")]);
  const rate = (paid, opening) => opening ? (paid / opening * 100).toFixed(1) + "%" : "0.0%";
  async function exportReport(kind) {
    setExporting(true);
    try {
      if (!window.html2canvas) throw new Error("이미지 변환 모듈을 불러오지 못했습니다.");
      const canvas = await window.html2canvas(reportRef.current, {
        scale: 2,
        backgroundColor: "#eef1f6",
        useCORS: true
      });
      const base = "결산회의_부서별_미수채권현황_" + data.meta.today;
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
        const pageHeight = Math.floor(canvas.width * 6.75 / 12.65);
        const reportBox = reportRef.current.getBoundingClientRect();
        const scaleY = canvas.height / reportBox.height;
        const rowCuts = [...reportRef.current.querySelectorAll(".closing-detail tbody tr, .closing-detail tfoot tr")].map(row => Math.min(canvas.height, Math.round((row.getBoundingClientRect().bottom - reportBox.top) * scaleY) + 2)).sort((a, b) => a - b);
        let top = 0;
        while (top < canvas.height) {
          const desiredBottom = Math.min(canvas.height, top + pageHeight);
          const safeCuts = rowCuts.filter(cut => cut > top + 80 && cut <= desiredBottom);
          const bottom = desiredBottom === canvas.height ? canvas.height : safeCuts.length ? safeCuts[safeCuts.length - 1] : desiredBottom;
          const slice = document.createElement("canvas");
          slice.width = canvas.width;
          slice.height = bottom - top;
          slice.getContext("2d").drawImage(canvas, 0, top, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
          const slide = pptx.addSlide();
          slide.background = {
            color: "EEF1F6"
          };
          slide.addText("㈜메드파크 결산회의용 부서별 미수채권현황", {
            x: .35,
            y: .1,
            w: 9,
            h: .3,
            fontFace: "Pretendard",
            fontSize: 16,
            bold: true,
            color: "16202E"
          });
          slide.addText("기준일 " + data.meta.today, {
            x: 10.2,
            y: .15,
            w: 2.75,
            h: .2,
            align: "right",
            fontSize: 9,
            color: "5C6B80"
          });
          slide.addImage({
            data: slice.toDataURL("image/png"),
            x: .34,
            y: .48,
            w: 12.65,
            h: 12.65 * slice.height / slice.width
          });
          top = bottom;
        }
        await pptx.writeFile({
          fileName: base + ".pptx"
        });
      }
      notify((kind === "png" ? "그림파일" : "PPT") + " 다운로드를 시작했습니다.");
    } catch (e) {
      notify(e.message, true);
    } finally {
      setExporting(false);
    }
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "closing-toolbar"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "사업부"
  }, /*#__PURE__*/React.createElement("select", {
    className: "select",
    value: unit,
    onChange: e => setUnit(e.target.value)
  }, /*#__PURE__*/React.createElement("option", null, "전체"), data.meta.units.map(u => /*#__PURE__*/React.createElement("option", {
    key: u
  }, u)))), /*#__PURE__*/React.createElement("div", {
    className: "spacer"
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-muted t-sm"
  }, "결산회의용 다운로드"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm",
    disabled: exporting,
    onClick: () => exportReport("png")
  }, "그림파일(PNG)"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm btn--primary",
    disabled: exporting,
    onClick: () => exportReport("pptx")
  }, "PPT")), /*#__PURE__*/React.createElement("div", {
    ref: reportRef,
    className: "closing-report"
  }, reports.length === 0 && /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    className: "zero-result"
  }, "조회 대상 채권이 없습니다.")), reports.map(report => /*#__PURE__*/React.createElement(Card, {
    key: report.unit,
    title: (unitNames[report.unit] || report.unit) + " · 미수채권현황",
    flush: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "closing-meta"
  }, "기준일 ", data.meta.today, " · 잔액이 있는 채권만 표시"), /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", {
    className: "closing-summary"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "구분"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "기초"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "수금액"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "잔액"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "회수율"), /*#__PURE__*/React.createElement("th", null, "주요사항"))), /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", {
    className: "closing-summary--overdue"
  }, /*#__PURE__*/React.createElement("td", null, "미수채권"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(report.overdueOpening)), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(report.overdueCollected)), /*#__PURE__*/React.createElement("td", {
    className: "r num t-strong"
  }, won(report.overdueBalance)), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, rate(report.overdueCollected, report.overdueOpening)), /*#__PURE__*/React.createElement("td", null, report.detail.filter(x => x.notes.length).length, "개 거래처 특이사항 등록")), report.normalOpening > 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, "정상채권 (수금 대상)"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(report.normalOpening)), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(report.normalCollected)), /*#__PURE__*/React.createElement("td", {
    className: "r num t-strong"
  }, won(report.normalBalance)), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, rate(report.normalCollected, report.normalOpening)), /*#__PURE__*/React.createElement("td", null))))), /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", {
    className: "closing-detail"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "거래처명"), /*#__PURE__*/React.createElement("th", null, "사업부"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "회수기간"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "연체기간"), /*#__PURE__*/React.createElement("th", null, "채권구분"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "채권잔액"), /*#__PURE__*/React.createElement("th", null, "특이사항"))), /*#__PURE__*/React.createElement("tbody", null, report.detail.map(row => /*#__PURE__*/React.createElement("tr", {
    key: row.code + row.category
  }, /*#__PURE__*/React.createElement("td", {
    className: "t-strong"
  }, row.name), /*#__PURE__*/React.createElement("td", null, report.unit), /*#__PURE__*/React.createElement("td", {
    className: row.period == null || Number(row.period) < 0 ? "customer-period--missing" : "r num"
  }, row.grouped ? "합산" : row.period == null || Number(row.period) < 0 ? "미입력" : Number(row.period) + "개월"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, row.months, "개월"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Badge, {
    status: "연체"
  })), /*#__PURE__*/React.createElement("td", {
    className: "r num closing-amount"
  }, won(row.amount)), /*#__PURE__*/React.createElement("td", {
    className: "closing-notes"
  }, row.notes.join(" · ") || "–")))), /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 5
  }, "합계 · ", report.detail.length, "건"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(sum(report.detail, "amount"))), /*#__PURE__*/React.createElement("td", null)))))))));
}

/* ══════════════════ 거래처별 현황 ══════════════════ */

function InlineEdit({
  value,
  type = "text",
  placeholder,
  canEdit,
  onSave,
  formatValue
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  useEffect(() => {
    if (!editing) setDraft(value || "");
  }, [value, editing]);
  async function commit() {
    setEditing(false);
    if (draft === (value || "")) return;
    await onSave(draft);
  }
  if (!editing) return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "inline-edit",
    disabled: !canEdit,
    onClick: () => canEdit && setEditing(true)
  }, value !== "" && value != null ? formatValue ? formatValue(value) : value : /*#__PURE__*/React.createElement("span", {
    className: "t-muted"
  }, placeholder));
  return /*#__PURE__*/React.createElement("input", {
    className: "input input--compact",
    type: type,
    value: draft,
    autoFocus: true,
    onChange: e => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: e => {
      if (e.key === "Enter") e.currentTarget.blur();
      if (e.key === "Escape") setEditing(false);
    }
  });
}
function Customers({
  data,
  can,
  preset,
  notify,
  patchCustomer
}) {
  const [unit, setUnit] = useState(preset && preset.unit || "전체");
  const [type, setType] = useState(preset && preset.status || "전체");
  const [q, setQ] = useState("");
  const [periodFilter, setPeriodFilter] = useState("전체");
  const [ownerFilter, setOwnerFilter] = useState("전체");
  const [ageFilter, setAgeFilter] = useState("전체");
  const [editingNote, setEditingNote] = useState(null);
  const [draftNote, setDraftNote] = useState("");
  const [receivableDetail, setReceivableDetail] = useState(null);
  useEffect(() => {
    if (preset) {
      setUnit(preset.unit);
      setType(preset.status);
    }
  }, [preset]);
  const rows = useMemo(() => customersForUnit(data.customers, unit).flatMap(c => {
    const parts = [{
      status: "정상",
      balance: Number(c.normal_balance) || 0,
      months: 0
    }, {
      status: "연체",
      balance: Number(c.overdue_balance) || 0,
      months: overdueMonths(c.overdue_days)
    }, {
      status: "부실",
      balance: Number(c.bad_balance) || 0,
      months: overdueMonths(c.overdue_days)
    }].filter(part => part.balance !== 0);
    return parts.map((part, index) => ({
      ...c,
      ...part,
      advance: index === 0 ? c.advance : 0,
      rowKey: c.code + "-" + c.biz_unit + "-" + part.status
    }));
  }).filter(c => {
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
    if (q && !(c.name.includes(q) || c.code.includes(q) || code5(c.code).includes(q) || (c.owner || "").includes(q))) return false;
    return true;
  }), [data.customers, unit, type, q, periodFilter, ownerFilter, ageFilter]);
  const owners = useMemo(() => [...new Set(data.customers.map(c => c.owner).filter(Boolean))].sort(), [data.customers]);
  async function updateCustomer(code, body, message) {
    try {
      const {
        customer
      } = await api("/tf/ar/api/customers/" + encodeURIComponent(code), {
        method: "PATCH",
        body
      });
      patchCustomer(customer);
      notify(message);
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function saveNote(code) {
    await updateCustomer(code, {
      note: draftNote
    }, "비고를 저장했습니다.");
    setEditingNote(null);
  }
  async function openReceivables(c) {
    try {
      const result = await api("/tf/ar/api/customers/" + encodeURIComponent(c.code) + "/receivables");
      setReceivableDetail({
        ...result,
        name: c.name
      });
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function saveItemTarget(itemId, target_date) {
    try {
      const result = await api("/tf/ar/api/receivables/" + itemId, {
        method: "PATCH",
        body: {
          target_date
        }
      });
      setReceivableDetail(d => ({
        ...d,
        items: d.items.map(x => x.id === itemId ? result.item : x)
      }));
      notify("채권별 수금목표일을 저장했습니다.");
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function saveItemNote(itemId, note) {
    try {
      const result = await api("/tf/ar/api/receivables/" + itemId, {
        method: "PATCH",
        body: {
          note
        }
      });
      const items = receivableDetail.items.map(x => x.id === itemId ? result.item : x);
      setReceivableDetail(d => ({
        ...d,
        items
      }));
      patchCustomer({
        ...receivableDetail.customer,
        detail_notes: [...new Set(items.map(x => x.note).filter(Boolean))]
      });
      notify("채권 비고를 저장하고 거래처 현황에 취합 반영했습니다.");
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function reclassifyAsOverdue(item) {
    if (!window.confirm(won(item.balance) + "원을 정상채권에서 미수채권으로 전환할까요?")) return;
    try {
      const result = await api("/tf/ar/api/receivables/" + item.id, {
        method: "PATCH",
        body: {
          category: "연체"
        }
      });
      setReceivableDetail(d => ({
        ...d,
        customer: result.customer,
        items: d.items.map(x => x.id === item.id ? {
          ...result.item,
          as_of_status: "연체"
        } : x)
      }));
      patchCustomer(result.customer);
      notify("정상채권을 미수채권으로 전환했습니다.");
    } catch (e) {
      notify(e.message, true);
    }
  }
  const distinctCustomers = new Set(rows.map(r => r.code)).size;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    title: "조회 조건"
  }, /*#__PURE__*/React.createElement("div", {
    className: "customer-filters"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "사업부별 필터"
  }, /*#__PURE__*/React.createElement("select", {
    className: "select",
    value: unit,
    onChange: e => setUnit(e.target.value)
  }, /*#__PURE__*/React.createElement("option", null, "전체"), data.meta.units.map(u => /*#__PURE__*/React.createElement("option", {
    key: u
  }, u)))), /*#__PURE__*/React.createElement(Field, {
    label: "채권유형별 필터"
  }, /*#__PURE__*/React.createElement("select", {
    className: "select",
    value: type,
    onChange: e => setType(e.target.value)
  }, /*#__PURE__*/React.createElement("option", null, "전체"), data.meta.statuses.map(s => /*#__PURE__*/React.createElement("option", {
    key: s,
    value: s
  }, STATUS_LABEL[s])))), /*#__PURE__*/React.createElement(Field, {
    label: "회수기간"
  }, /*#__PURE__*/React.createElement("select", {
    className: "select",
    value: periodFilter,
    onChange: e => setPeriodFilter(e.target.value)
  }, /*#__PURE__*/React.createElement("option", null, "전체"), /*#__PURE__*/React.createElement("option", null, "미입력"), /*#__PURE__*/React.createElement("option", null, "입력"))), /*#__PURE__*/React.createElement(Field, {
    label: "담당자"
  }, /*#__PURE__*/React.createElement("select", {
    className: "select",
    value: ownerFilter,
    onChange: e => setOwnerFilter(e.target.value)
  }, /*#__PURE__*/React.createElement("option", null, "전체"), /*#__PURE__*/React.createElement("option", null, "미배정"), owners.map(o => /*#__PURE__*/React.createElement("option", {
    key: o
  }, o)))), /*#__PURE__*/React.createElement(Field, {
    label: "연체기간"
  }, /*#__PURE__*/React.createElement("select", {
    className: "select",
    value: ageFilter,
    onChange: e => setAgeFilter(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "전체"
  }, "전체"), /*#__PURE__*/React.createElement("option", {
    value: "0"
  }, "0개월"), /*#__PURE__*/React.createElement("option", {
    value: "1-3"
  }, "1~3개월"), /*#__PURE__*/React.createElement("option", {
    value: "4-11"
  }, "4~11개월"), /*#__PURE__*/React.createElement("option", {
    value: "12+"
  }, "12개월 이상"))), /*#__PURE__*/React.createElement(Field, {
    label: "거래처 검색"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    lang: "ko",
    inputMode: "text",
    value: q,
    placeholder: "거래처명·코드·담당자",
    onChange: e => setQ(e.target.value)
  })), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm",
    onClick: () => {
      setUnit("전체");
      setType("전체");
      setPeriodFilter("전체");
      setOwnerFilter("전체");
      setAgeFilter("전체");
      setQ("");
    }
  }, "초기화"))), /*#__PURE__*/React.createElement(Card, {
    title: (STATUS_LABEL[type] || type) + " · 거래처 " + distinctCustomers + "곳 / 채권 " + rows.length + "건",
    flush: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "tablewrap customer-table"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "코드"), /*#__PURE__*/React.createElement("th", null, "거래처명"), /*#__PURE__*/React.createElement("th", null, "사업부"), /*#__PURE__*/React.createElement("th", null, "채권유형"), /*#__PURE__*/React.createElement("th", null, "회수기간"), /*#__PURE__*/React.createElement("th", null, "담당자"), /*#__PURE__*/React.createElement("th", null, "수금목표일"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "채권잔액"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "선수금"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "연체기간(개월)"), /*#__PURE__*/React.createElement("th", null, "최종수금일"), /*#__PURE__*/React.createElement("th", {
    style: {
      minWidth: 180
    }
  }, "비고"))), /*#__PURE__*/React.createElement("tbody", null, rows.map(c => /*#__PURE__*/React.createElement("tr", {
    key: c.rowKey
  }, /*#__PURE__*/React.createElement("td", {
    className: "num t-muted"
  }, code5(c.code)), /*#__PURE__*/React.createElement("td", {
    className: "t-strong"
  }, c.name), /*#__PURE__*/React.createElement("td", null, c.biz_unit), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Badge, {
    status: c.status
  })), /*#__PURE__*/React.createElement("td", {
    className: "num" + (c.period == null || Number(c.period) < 0 ? " customer-period--missing" : "")
  }, /*#__PURE__*/React.createElement(InlineEdit, {
    value: c.period == null || Number(c.period) < 0 ? "" : String(c.period),
    placeholder: "미입력",
    type: "number",
    canEdit: can("customer_info_edit"),
    formatValue: value => Number(value) === 0 ? "0개월 (당월)" : Number(value) === 1 ? "1개월 (익월)" : value + "개월",
    onSave: period => updateCustomer(c.code, {
      period
    }, "회수기간을 저장했습니다.")
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(InlineEdit, {
    value: c.owner,
    placeholder: "클릭해 입력",
    canEdit: can("note_edit"),
    onSave: owner => updateCustomer(c.code, {
      owner
    }, "담당자를 저장했습니다.")
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "inline-edit",
    onClick: () => openReceivables(c)
  }, "채권별 목표 설정")), /*#__PURE__*/React.createElement("td", {
    className: "r num t-strong"
  }, won(c.balance)), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, c.advance ? won(c.advance) : "–"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, c.months, "개월"), /*#__PURE__*/React.createElement("td", {
    className: "num t-muted t-sm"
  }, c.last_paid_at || "–"), /*#__PURE__*/React.createElement("td", {
    style: {
      whiteSpace: "normal"
    }
  }, editingNote === c.rowKey ? /*#__PURE__*/React.createElement("div", {
    className: "inline-note"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: draftNote,
    autoFocus: true,
    onChange: e => setDraftNote(e.target.value),
    onKeyDown: e => e.key === "Enter" && saveNote(c.code)
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm btn--primary",
    onClick: () => saveNote(c.code)
  }, "저장"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm",
    onClick: () => setEditingNote(null)
  }, "취소")) : /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "inline-edit",
    disabled: !can("note_edit"),
    onClick: () => {
      setEditingNote(c.rowKey);
      setDraftNote(c.note || "");
    }
  }, [c.note, ...(c.detail_notes || [])].filter(Boolean).join(" · ") || /*#__PURE__*/React.createElement("span", {
    className: "t-muted"
  }, "클릭해 입력")))))), rows.length === 0 && /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 12,
    className: "zero-result"
  }, "조회 결과 ", /*#__PURE__*/React.createElement("b", null, "0원")))), /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 7
  }, "합계 · 거래처 ", distinctCustomers, "곳 / 채권 ", rows.length, "건"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(sum(rows, "balance"))), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(sum(rows, "advance"))), /*#__PURE__*/React.createElement("td", {
    colSpan: 3
  })))))), receivableDetail && /*#__PURE__*/React.createElement("div", {
    className: "modal-backdrop",
    onMouseDown: () => setReceivableDetail(null)
  }, /*#__PURE__*/React.createElement("section", {
    className: "modal-card modal-card--wide",
    onMouseDown: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("header", {
    className: "card__head"
  }, /*#__PURE__*/React.createElement("h3", null, receivableDetail.name, " · 발생월별 채권 상세"), /*#__PURE__*/React.createElement("div", {
    className: "spacer"
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm",
    onClick: () => setReceivableDetail(null)
  }, "닫기")), /*#__PURE__*/React.createElement("div", {
    className: "alert alert--info",
    style: {
      margin: 14
    }
  }, "조회기준일 ", receivableDetail.as_of, " · 발생월별 잔액과 정상회수월을 확인하고 채권별 목표일을 입력합니다."), /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "사업부"), /*#__PURE__*/React.createElement("th", null, "채권발생월"), /*#__PURE__*/React.createElement("th", null, "정상회수월"), /*#__PURE__*/React.createElement("th", null, "현재 구분"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "최초금액"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "현재잔액"), /*#__PURE__*/React.createElement("th", null, "수금목표일"), /*#__PURE__*/React.createElement("th", null, "비고"), /*#__PURE__*/React.createElement("th", null, "관리"))), /*#__PURE__*/React.createElement("tbody", null, receivableDetail.items.map(item => /*#__PURE__*/React.createElement("tr", {
    key: item.id
  }, /*#__PURE__*/React.createElement("td", {
    className: "t-strong"
  }, item.biz_unit || receivableDetail.customer.biz_unit), /*#__PURE__*/React.createElement("td", {
    className: "num t-strong"
  }, item.issue_month || "미확인"), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, item.target_month || "미입력"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Badge, {
    status: item.as_of_status || item.category
  })), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(item.original_amount)), /*#__PURE__*/React.createElement("td", {
    className: "r num t-strong"
  }, won(item.balance)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(InlineEdit, {
    value: item.target_date,
    placeholder: "목표일 입력",
    type: "date",
    canEdit: can("customer_info_edit"),
    onSave: value => saveItemTarget(item.id, value)
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(InlineEdit, {
    value: item.note,
    placeholder: "비고 입력",
    canEdit: can("note_edit"),
    onSave: value => saveItemNote(item.id, value)
  })), /*#__PURE__*/React.createElement("td", null, item.category === "정상" && Number(item.balance) > 0 ? /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm btn--warn",
    disabled: !can("customer_info_edit"),
    onClick: () => reclassifyAsOverdue(item)
  }, "미수 전환") : "–")))))))));
}

/* ══════════════════ 담당자별 채권현황 ══════════════════ */

function Owners({
  data
}) {
  const [owner, setOwner] = useState("전체");
  const list = useMemo(() => {
    const map = {};
    data.customers.forEach(c => {
      const k = c.owner || "미지정";
      map[k] = map[k] || {
        owner: k,
        rows: [],
        total: 0,
        정상: 0,
        연체: 0,
        부실: 0
      };
      map[k].rows.push(c);
      map[k].total += c.balance;
      map[k][c.status] += c.balance;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [data.customers]);
  const active = owner === "전체" ? null : list.find(o => o.owner === owner);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "chiprow"
  }, /*#__PURE__*/React.createElement("button", {
    className: "chip",
    "aria-pressed": owner === "전체",
    onClick: () => setOwner("전체")
  }, "전체"), list.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.owner,
    className: "chip",
    "aria-pressed": owner === o.owner,
    onClick: () => setOwner(o.owner)
  }, o.owner, " (", o.rows.length, ")"))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid--3"
  }, (active ? [active] : list).map(o => /*#__PURE__*/React.createElement(Card, {
    key: o.owner,
    title: o.owner
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi__value num",
    style: {
      marginTop: 0
    }
  }, short(o.total).value, /*#__PURE__*/React.createElement("em", null, short(o.total).unit)), /*#__PURE__*/React.createElement("div", {
    className: "kpi__meta num",
    style: {
      marginBottom: 12
    }
  }, "거래처 ", o.rows.length, "곳 · ", won(o.total), "원"), /*#__PURE__*/React.createElement("div", {
    className: "signal__bar"
  }, ["정상", "연체", "부실"].map(s => o[s] > 0 && /*#__PURE__*/React.createElement("div", {
    key: s,
    className: "signal__seg signal__seg--" + STATUS_STYLE[s],
    style: {
      width: o[s] / o.total * 100 + "%"
    },
    title: STATUS_LABEL[s] + " " + won(o[s])
  })))))), active && /*#__PURE__*/React.createElement(Card, {
    title: active.owner + " 담당 거래처",
    flush: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "코드"), /*#__PURE__*/React.createElement("th", null, "거래처명"), /*#__PURE__*/React.createElement("th", null, "사업부"), /*#__PURE__*/React.createElement("th", null, "분류"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "채권잔액"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "연체기간(개월)"), /*#__PURE__*/React.createElement("th", null, "비고"))), /*#__PURE__*/React.createElement("tbody", null, [...active.rows].sort((a, b) => b.balance - a.balance).map(c => /*#__PURE__*/React.createElement("tr", {
    key: c.code
  }, /*#__PURE__*/React.createElement("td", {
    className: "num t-muted"
  }, code5(c.code)), /*#__PURE__*/React.createElement("td", {
    className: "t-strong"
  }, c.name), /*#__PURE__*/React.createElement("td", null, c.biz_unit), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Badge, {
    status: c.status
  })), /*#__PURE__*/React.createElement("td", {
    className: "r num t-strong"
  }, won(c.balance)), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, overdueMonths(c.overdue_days), "개월"), /*#__PURE__*/React.createElement("td", {
    className: "t-sm t-muted",
    style: {
      whiteSpace: "normal"
    }
  }, c.note || "–")))), /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 4
  }, "합계"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(active.total)), /*#__PURE__*/React.createElement("td", {
    colSpan: 2
  })))))));
}

/* ══════════════════ 수금 등록 ══════════════════ */

function CustomerSearch({
  customers,
  value,
  onChange
}) {
  const selected = customers.find(c => c.code === value);
  const [query, setQuery] = useState(selected ? selected.name : "");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return customers.filter(c => !keyword || c.name.toLowerCase().includes(keyword) || String(c.code).toLowerCase().includes(keyword) || code5(c.code).includes(keyword)).slice(0, 12);
  }, [customers, query]);
  useEffect(() => {
    if (!value) setQuery("");
  }, [value]);
  function choose(customer) {
    onChange(customer.code);
    setQuery(customer.name);
    setOpen(false);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "customer-search"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    lang: "ko",
    inputMode: "text",
    value: query,
    placeholder: "거래처명 또는 코드 검색",
    role: "combobox",
    "aria-expanded": open,
    "aria-autocomplete": "list",
    onFocus: () => setOpen(true),
    onBlur: () => setTimeout(() => setOpen(false), 150),
    onChange: e => {
      setQuery(e.target.value);
      onChange("");
      setOpen(true);
    }
  }), open && /*#__PURE__*/React.createElement("div", {
    className: "customer-search__menu",
    role: "listbox"
  }, matches.map(c => /*#__PURE__*/React.createElement("button", {
    type: "button",
    role: "option",
    key: c.code,
    className: "customer-search__option",
    onMouseDown: e => e.preventDefault(),
    onClick: () => choose(c)
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, c.name), /*#__PURE__*/React.createElement("small", null, code5(c.code), " · ", c.biz_unit)), /*#__PURE__*/React.createElement("strong", {
    className: "num"
  }, won(c.balance), "원"))), matches.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "customer-search__empty"
  }, "검색 결과가 없습니다.")));
}
function Collections({
  data,
  can,
  notify,
  refresh
}) {
  const [form, setForm] = useState({
    customer_code: "",
    amount: "",
    method: "계좌수금",
    paid_at: today(),
    note: ""
  });
  const [busy, setBusy] = useState(false);
  const set = k => e => setForm({
    ...form,
    [k]: e.target.value
  });
  const setAmount = e => setForm({
    ...form,
    amount: formatAmountInput(e.target.value)
  });
  const pending = data.collections.filter(c => c.state === "pending");
  const decided = data.collections.filter(c => c.state !== "pending").slice(0, 40);
  const target = data.customers.find(c => c.code === form.customer_code);
  async function register() {
    setBusy(true);
    try {
      await api("/tf/ar/api/collections", {
        method: "POST",
        body: form
      });
      notify("수금 건을 등록했습니다. 재무담당 승인 후 잔액에 반영됩니다.");
      setForm({
        ...form,
        customer_code: "",
        amount: "",
        note: ""
      });
      await refresh();
    } catch (e) {
      notify(e.message, true);
    }
    setBusy(false);
  }
  async function decide(id, action) {
    try {
      const body = action === "reject" ? {
        reason: prompt("반려 사유를 입력하세요.") || ""
      } : {};
      await api("/tf/ar/api/collections/" + id + "/" + action, {
        method: "POST",
        body
      });
      notify(action === "approve" ? "승인했습니다. 잔액이 갱신되었습니다." : "반려했습니다.");
      await refresh();
    } catch (e) {
      notify(e.message, true);
    }
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, can("collection_register") && /*#__PURE__*/React.createElement(Card, {
    title: "수금 등록"
  }, /*#__PURE__*/React.createElement("div", {
    className: "formrow"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "거래처"
  }, /*#__PURE__*/React.createElement(CustomerSearch, {
    customers: data.customers,
    value: form.customer_code,
    onChange: code => setForm({
      ...form,
      customer_code: code
    })
  })), /*#__PURE__*/React.createElement(Field, {
    label: "수금액 (원)"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input num",
    inputMode: "numeric",
    value: form.amount,
    onChange: setAmount,
    placeholder: "0",
    "aria-describedby": "collection-amount-unit"
  }), /*#__PURE__*/React.createElement("small", {
    id: "collection-amount-unit",
    className: "amount-unit-check"
  }, form.amount ? "입력금액 · " + koreanAmountUnit(form.amount) : "숫자를 입력하면 금액 단위가 표시됩니다.")), /*#__PURE__*/React.createElement(Field, {
    label: "수금방법"
  }, /*#__PURE__*/React.createElement("select", {
    className: "select",
    value: form.method,
    onChange: set("method")
  }, data.meta.methods.map(m => /*#__PURE__*/React.createElement("option", {
    key: m
  }, m)))), /*#__PURE__*/React.createElement(Field, {
    label: "수금일"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "date",
    value: form.paid_at,
    onChange: set("paid_at")
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "비고"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: form.note,
    onChange: set("note"),
    placeholder: "입금자명, 분할 회차 등"
  })), target && amountNumber(form.amount) > target.balance && /*#__PURE__*/React.createElement("div", {
    className: "alert alert--warn"
  }, "입력한 수금액이 현재 미수잔액(", won(target.balance), "원)보다 큽니다. 금액을 확인하세요."), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--primary",
    onClick: register,
    disabled: busy || !form.customer_code || !form.amount
  }, "승인 요청으로 등록")), /*#__PURE__*/React.createElement(Card, {
    title: "승인 대기 " + pending.length + "건",
    flush: true
  }, pending.length === 0 ? /*#__PURE__*/React.createElement(Empty, {
    title: "대기 중인 수금 건이 없습니다."
  }, "영업담당이 등록하면 이곳에 표시됩니다.") : /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "등록일"), /*#__PURE__*/React.createElement("th", null, "거래처"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "수금액"), /*#__PURE__*/React.createElement("th", null, "방법"), /*#__PURE__*/React.createElement("th", null, "수금일"), /*#__PURE__*/React.createElement("th", null, "등록자"), /*#__PURE__*/React.createElement("th", null, "비고"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, pending.map(c => /*#__PURE__*/React.createElement("tr", {
    key: c.id
  }, /*#__PURE__*/React.createElement("td", {
    className: "t-sm t-muted num"
  }, (c.created_at || "").slice(0, 10)), /*#__PURE__*/React.createElement("td", {
    className: "t-strong"
  }, c.customer_name), /*#__PURE__*/React.createElement("td", {
    className: "r num t-strong"
  }, won(c.amount)), /*#__PURE__*/React.createElement("td", null, c.method), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, c.paid_at), /*#__PURE__*/React.createElement("td", null, c.registered_by), /*#__PURE__*/React.createElement("td", {
    className: "t-sm t-muted",
    style: {
      whiteSpace: "normal"
    }
  }, c.note || "–"), /*#__PURE__*/React.createElement("td", {
    className: "r"
  }, can("collection_approve") ? /*#__PURE__*/React.createElement("div", {
    className: "btnrow",
    style: {
      justifyContent: "flex-end"
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm btn--ok",
    onClick: () => decide(c.id, "approve")
  }, "승인"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm btn--danger",
    onClick: () => decide(c.id, "reject")
  }, "반려")) : /*#__PURE__*/React.createElement("span", {
    className: "badge badge--mute"
  }, "승인 대기"))))), /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 2
  }, "대기 합계"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(sum(pending, "amount"))), /*#__PURE__*/React.createElement("td", {
    colSpan: 5
  })))))), /*#__PURE__*/React.createElement(Card, {
    title: "처리 내역",
    flush: true
  }, decided.length === 0 ? /*#__PURE__*/React.createElement(Empty, {
    title: "처리된 내역이 없습니다."
  }) : /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "상태"), /*#__PURE__*/React.createElement("th", null, "거래처"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "수금액"), /*#__PURE__*/React.createElement("th", null, "방법"), /*#__PURE__*/React.createElement("th", null, "수금일"), /*#__PURE__*/React.createElement("th", null, "등록자"), /*#__PURE__*/React.createElement("th", null, "처리자"), /*#__PURE__*/React.createElement("th", null, "사유·비고"))), /*#__PURE__*/React.createElement("tbody", null, decided.map(c => /*#__PURE__*/React.createElement("tr", {
    key: c.id
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "badge badge--" + (c.state === "approved" ? "ok" : "bad")
  }, c.state === "approved" ? "승인" : "반려")), /*#__PURE__*/React.createElement("td", {
    className: "t-strong"
  }, c.customer_name), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(c.amount)), /*#__PURE__*/React.createElement("td", null, c.method), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, c.paid_at), /*#__PURE__*/React.createElement("td", null, c.registered_by), /*#__PURE__*/React.createElement("td", null, c.approved_by), /*#__PURE__*/React.createElement("td", {
    className: "t-sm t-muted",
    style: {
      whiteSpace: "normal"
    }
  }, c.reject_reason || c.note || "–"))))))));
}

/* ══════════════════ 수금목표 관리 ══════════════════ */

function Targets({
  data,
  notify,
  refresh
}) {
  const blank = {
    customer_code: "",
    amount: "",
    target_date: today(),
    method: "계좌수금",
    assignee: "",
    note: ""
  };
  const [form, setForm] = useState(blank);
  const set = k => e => setForm({
    ...form,
    [k]: e.target.value
  });
  const [filter, setFilter] = useState("진행");
  const rows = data.targets.filter(t => filter === "전체" ? true : filter === "완료" ? t.state === "done" : t.state !== "done");
  async function create() {
    try {
      await api("/tf/ar/api/targets", {
        method: "POST",
        body: form
      });
      setForm(blank);
      notify("수금목표를 추가했습니다.");
      await refresh();
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function patch(id, body) {
    try {
      await api("/tf/ar/api/targets/" + id, {
        method: "PATCH",
        body
      });
      await refresh();
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function remove(id) {
    if (!confirm("이 목표를 삭제할까요?")) return;
    try {
      await api("/tf/ar/api/targets/" + id, {
        method: "DELETE"
      });
      notify("삭제했습니다.");
      await refresh();
    } catch (e) {
      notify(e.message, true);
    }
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    title: "수금목표 추가"
  }, /*#__PURE__*/React.createElement("div", {
    className: "formrow"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "거래처"
  }, /*#__PURE__*/React.createElement(CustomerSearch, {
    customers: data.customers,
    value: form.customer_code,
    onChange: code => setForm({
      ...form,
      customer_code: code
    })
  })), /*#__PURE__*/React.createElement(Field, {
    label: "목표금액 (원)"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input num",
    inputMode: "numeric",
    value: form.amount,
    onChange: set("amount")
  })), /*#__PURE__*/React.createElement(Field, {
    label: "목표일"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "date",
    value: form.target_date,
    onChange: set("target_date")
  })), /*#__PURE__*/React.createElement(Field, {
    label: "수금방법"
  }, /*#__PURE__*/React.createElement("select", {
    className: "select",
    value: form.method,
    onChange: set("method")
  }, data.meta.methods.map(m => /*#__PURE__*/React.createElement("option", {
    key: m
  }, m)))), /*#__PURE__*/React.createElement(Field, {
    label: "담당자"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: form.assignee,
    onChange: set("assignee"),
    placeholder: "이름"
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "비고"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: form.note,
    onChange: set("note"),
    placeholder: "약속 내용, 연락 결과 등"
  })), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--primary",
    onClick: create,
    disabled: !form.customer_code || !form.target_date
  }, "목표 추가")), /*#__PURE__*/React.createElement(Card, {
    title: "수금목표 " + rows.length + "건",
    flush: true,
    actions: /*#__PURE__*/React.createElement("div", {
      className: "chiprow"
    }, ["진행", "완료", "전체"].map(f => /*#__PURE__*/React.createElement("button", {
      key: f,
      className: "chip",
      "aria-pressed": filter === f,
      onClick: () => setFilter(f)
    }, f)))
  }, rows.length === 0 ? /*#__PURE__*/React.createElement(Empty, {
    title: "등록된 목표가 없습니다."
  }, "위에서 첫 목표를 추가하세요.") : /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "목표일"), /*#__PURE__*/React.createElement("th", null, "거래처"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "목표금액"), /*#__PURE__*/React.createElement("th", null, "수금방법"), /*#__PURE__*/React.createElement("th", null, "담당자"), /*#__PURE__*/React.createElement("th", null, "완료일"), /*#__PURE__*/React.createElement("th", null, "비고"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, rows.map(t => {
    const late = t.state !== "done" && t.target_date < today();
    return /*#__PURE__*/React.createElement("tr", {
      key: t.id
    }, /*#__PURE__*/React.createElement("td", {
      className: "num",
      style: {
        color: late ? "var(--bad)" : "inherit",
        fontWeight: late ? 600 : 400
      }
    }, t.target_date, late && " ⚠"), /*#__PURE__*/React.createElement("td", {
      className: "t-strong"
    }, t.customer_name), /*#__PURE__*/React.createElement("td", {
      className: "r num"
    }, won(t.amount)), /*#__PURE__*/React.createElement("td", null, t.method || "–"), /*#__PURE__*/React.createElement("td", null, t.assignee || "–"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("input", {
      className: "input num",
      type: "date",
      style: {
        width: 148
      },
      value: t.done_date || "",
      onChange: e => patch(t.id, {
        done_date: e.target.value
      })
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        whiteSpace: "normal",
        minWidth: 180
      }
    }, /*#__PURE__*/React.createElement("input", {
      className: "input",
      defaultValue: t.note,
      onBlur: e => e.target.value !== t.note && patch(t.id, {
        note: e.target.value
      })
    })), /*#__PURE__*/React.createElement("td", {
      className: "r"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn--sm btn--danger",
      onClick: () => remove(t.id)
    }, "삭제")));
  })), /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 2
  }, "합계"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(sum(rows, "amount"))), /*#__PURE__*/React.createElement("td", {
    colSpan: 5
  })))))));
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
  note: ["비고", "특이사항", "메모"]
};
function mapHeaders(headers) {
  const map = {};
  const cleaned = headers.map(h => String(h || "").replace(/\s/g, ""));
  // '고객'이 '고객코드'에 먼저 걸리는 일을 막기 위해 정확히 같은 머리글을 최우선으로 찾는다.
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const normalized = aliases.map(a => a.replace(/\s/g, ""));
    const exact = cleaned.findIndex(header => normalized.includes(header));
    if (exact >= 0) map[field] = exact;
  }
  // 과거 서식의 부가 문구가 붙은 머리글만 부분 일치로 보완한다.
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (map[field] !== undefined) continue;
    const normalized = aliases.map(a => a.replace(/\s/g, ""));
    const fuzzy = cleaned.findIndex(header => normalized.some(a => a && header.includes(a)));
    if (fuzzy >= 0) map[field] = fuzzy;
  }
  return map;
}
function Upload({
  data,
  can,
  notify,
  applyUpload,
  refresh
}) {
  const [month, setMonth] = useState(thisMonth());
  const [shipmentDate, setShipmentDate] = useState(data.meta.today);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const lockOf = m => data.locks.find(l => l.month === m);
  const locked = !!(lockOf(month) && lockOf(month).locked);
  function readFile(file) {
    setError("");
    setParsed(null);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, {
          type: "array"
        });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          blankrows: false
        });
        let headerRow = -1,
          map = {};
        for (let i = 0; i < Math.min(grid.length, 15); i++) {
          const candidate = mapHeaders(grid[i] || []);
          if (candidate.code !== undefined && candidate.name !== undefined) {
            headerRow = i;
            map = candidate;
            break;
          }
        }
        if (headerRow < 0) {
          setError("머리글 행을 찾지 못했습니다. '거래처코드'와 '거래처명' 열이 있는지 확인하세요.");
          return;
        }
        const shipmentMode = map.shipment_amount !== undefined;
        const cleanHeaders = (grid[headerRow] || []).map(h => String(h || "").replace(/\s/g, ""));
        const amaranthMode = ["고객코드", "고객", "대분류", "합계액"].every(header => cleanHeaders.includes(header));
        const required = shipmentMode ? ["code", "name", "biz_unit"] : ["code", "name", "biz_unit", "normal_balance", "overdue_balance", "bad_balance"];
        const missing = required.filter(field => map[field] === undefined);
        if (missing.length) {
          setError("필수 열이 없습니다: " + missing.map(field => ({
            code: "거래처코드",
            name: "거래처명",
            biz_unit: "사업부",
            normal_balance: "정상채권잔액",
            overdue_balance: "미수채권(11개월 내)",
            bad_balance: "부실채권(12개월 이상)",
            collection_period: "회수기간(개월)",
            shipment_amount: "출고금액"
          })[field]).join(", "));
          return;
        }
        const rows = [],
          issues = [];
        const unitMap = {
          "제품_덴탈_국내": "덴탈",
          "제품_메디컬_국내": "메디컬",
          "제품_에스테틱_국내": "에스테틱"
        };
        for (let i = headerRow + 1; i < grid.length; i++) {
          const raw = grid[i] || [];
          const pick = f => map[f] === undefined ? "" : raw[map[f]];
          const code = String(pick("code") || "").trim();
          if (!code || /^#REF|^#N\/A/.test(code)) continue;
          const normalizedCode = /^\d+$/.test(code) ? code.padStart(5, "0") : code;
          const name = String(pick("name") || "").trim();
          const rawBizUnit = String(pick("biz_unit") || "").trim();
          const bizUnit = amaranthMode ? unitMap[rawBizUnit] || "" : rawBizUnit;
          if (!name) issues.push(i + 1 + "행: 거래처명 누락");
          if (!data.meta.units.includes(bizUnit)) issues.push(i + 1 + "행: 사업부 오류");
          const period = pick("collection_period");
          if (shipmentMode && period !== "" && (Number(period) < 0 || !Number.isFinite(Number(period)))) {
            issues.push(i + 1 + "행: 회수기간 오류");
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
            overdue_days: map.overdue_months !== undefined ? (Number(pick("overdue_months")) || 0) * 30 : pick("overdue_days"),
            last_paid_at: String(pick("last_paid_at") || "").trim(),
            note: String(pick("note") || "").trim()
          });
        }
        let preparedRows = rows;
        let multiUnitCodes = [];
        if (amaranthMode) {
          const grouped = new Map();
          rows.forEach(r => {
            const key = r.code + "|" + r.biz_unit;
            const current = grouped.get(key);
            if (current) current.shipment_amount = Number(current.shipment_amount || 0) + Number(r.shipment_amount || 0);else grouped.set(key, {
              ...r,
              shipment_amount: Number(r.shipment_amount || 0)
            });
          });
          preparedRows = Array.from(grouped.values());
          const unitsByCode = new Map();
          preparedRows.forEach(r => {
            if (!unitsByCode.has(r.code)) unitsByCode.set(r.code, new Set());
            unitsByCode.get(r.code).add(r.biz_unit);
          });
          multiUnitCodes = Array.from(unitsByCode.entries()).filter(([, units]) => units.size > 1).map(([code]) => code);
        }
        const seen = new Set(),
          dupes = [];
        preparedRows.forEach(r => {
          if (!amaranthMode && seen.has(r.code)) dupes.push(r.code);
          seen.add(r.code);
        });
        setParsed({
          filename: file.name,
          rows: preparedRows,
          dupes,
          issues,
          mapped: Object.keys(map),
          amaranthMode,
          multiUnitCodes,
          mode: shipmentMode ? "shipment" : "snapshot"
        });
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
        body: {
          month,
          shipment_date: shipmentDate,
          filename: parsed.filename,
          rows: parsed.rows,
          mode: parsed.mode
        }
      });
      applyUpload(res);
      notify(res.inserted + "행을 반영했습니다. 기존 " + res.replaced + "행은 교체되었습니다.");
      setParsed(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      notify(e.message, true);
    }
    setBusy(false);
  }
  async function toggleLock() {
    try {
      await api("/tf/ar/api/locks/" + month, {
        method: "POST",
        body: {
          locked: !locked
        }
      });
      notify(locked ? month + " 잠금을 해제했습니다." : month + " 을 마감 잠금했습니다.");
      await refresh();
    } catch (e) {
      notify(e.message, true);
    }
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    title: "출고 데이터 업로드"
  }, /*#__PURE__*/React.createElement("div", {
    className: "formrow"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "기준월"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "month",
    value: month,
    onChange: e => setMonth(e.target.value)
  })), /*#__PURE__*/React.createElement(Field, {
    label: "출고기준일"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "date",
    value: shipmentDate,
    onChange: e => setShipmentDate(e.target.value)
  })), /*#__PURE__*/React.createElement(Field, {
    label: "마감 상태"
  }, /*#__PURE__*/React.createElement("div", {
    className: "btnrow",
    style: {
      alignItems: "center",
      minHeight: 38
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "badge badge--" + (locked ? "bad" : "ok")
  }, locked ? "잠김" : "열림"), can("month_lock") && /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm",
    onClick: toggleLock
  }, locked ? "잠금 해제" : "마감 잠금")))), /*#__PURE__*/React.createElement("div", {
    className: "dropzone" + (over ? " is-over" : ""),
    onDragOver: e => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: e => {
      e.preventDefault();
      setOver(false);
      if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "0 0 10px"
    }
  }, "엑셀 파일을 끌어다 놓거나 아래에서 선택하세요."), /*#__PURE__*/React.createElement("input", {
    ref: fileRef,
    type: "file",
    accept: ".xlsx,.xls,.csv",
    onChange: e => e.target.files[0] && readFile(e.target.files[0])
  }), /*#__PURE__*/React.createElement("p", {
    className: "t-sm t-muted",
    style: {
      margin: "12px 0 0"
    }
  }, "아마란스10 출고현황 원본: E열 고객코드 · F열 고객 · AK열 대분류 · AB열 합계액을 자동 인식합니다.")), error && /*#__PURE__*/React.createElement("div", {
    className: "alert alert--bad",
    style: {
      marginTop: 12
    }
  }, error), locked && /*#__PURE__*/React.createElement("div", {
    className: "alert alert--warn",
    style: {
      marginTop: 12
    }
  }, month, " 은 마감 잠금 상태라 업로드할 수 없습니다. 잠금을 해제한 뒤 다시 시도하세요."), parsed && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "alert alert--info"
  }, /*#__PURE__*/React.createElement("b", null, parsed.filename), " — 유효한 ", parsed.rows.length, "행을 읽었습니다.", parsed.amaranthMode && " 아마란스10 원본 서식으로 인식했습니다.", "인식한 열: ", parsed.mapped.length, "개.", parsed.dupes.length > 0 && (parsed.amaranthMode ? " 복수 사업부 코드 " + parsed.dupes.length + "건을 사업부별로 분리합니다." : " 중복 코드 " + parsed.dupes.length + "건이 있습니다.")), (parsed.dupes.length > 0 || parsed.issues.length > 0) && /*#__PURE__*/React.createElement("div", {
    className: "alert alert--bad",
    style: {
      marginTop: 10
    }
  }, "업로드 전 수정 필요: ", parsed.dupes.length > 0 && "중복 코드 " + parsed.dupes.join(", "), parsed.dupes.length > 0 && parsed.issues.length > 0 && " · ", parsed.issues.slice(0, 8).join(" · "), parsed.issues.length > 8 && " 외 " + (parsed.issues.length - 8) + "건"), /*#__PURE__*/React.createElement("p", {
    className: "t-sm t-muted"
  }, parsed.mode === "shipment" ? month + " 출고분만 재설정하며 회수기간에 따라 수금대상월을 자동 산출합니다." : month + " 의 기존 확정 채권 데이터를 교체합니다.", " 다른 월 데이터는 그대로 유지됩니다."), /*#__PURE__*/React.createElement("div", {
    className: "tablewrap",
    style: {
      maxHeight: 260,
      overflowY: "auto",
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "코드"), /*#__PURE__*/React.createElement("th", null, "거래처명"), /*#__PURE__*/React.createElement("th", null, "사업부"), /*#__PURE__*/React.createElement("th", null, parsed.mode === "shipment" ? "회수기간" : "분류"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, parsed.mode === "shipment" ? "출고금액" : "채권잔액"))), /*#__PURE__*/React.createElement("tbody", null, parsed.rows.slice(0, 12).map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, r.code), /*#__PURE__*/React.createElement("td", null, r.name), /*#__PURE__*/React.createElement("td", null, r.biz_unit || "–"), /*#__PURE__*/React.createElement("td", null, parsed.mode === "shipment" ? r.collection_period + "개월" : r.status || "자동판정"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, won(parsed.mode === "shipment" ? r.shipment_amount : r.balance))))))), /*#__PURE__*/React.createElement("div", {
    className: "btnrow"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn--primary",
    onClick: send,
    disabled: busy || locked || !shipmentDate || parsed.dupes.length > 0 || parsed.issues.length > 0
  }, month, " 데이터로 반영"), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: () => setParsed(null)
  }, "취소")))), /*#__PURE__*/React.createElement(Card, {
    title: "업로드 이력",
    flush: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "업로드 일시"), /*#__PURE__*/React.createElement("th", null, "출고기준일"), /*#__PURE__*/React.createElement("th", null, "기준월"), /*#__PURE__*/React.createElement("th", null, "파일명"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "반영 행"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "교체된 행"), /*#__PURE__*/React.createElement("th", null, "업로더"), /*#__PURE__*/React.createElement("th", null, "마감"))), /*#__PURE__*/React.createElement("tbody", null, data.uploads.map(u => {
    const l = lockOf(u.month);
    return /*#__PURE__*/React.createElement("tr", {
      key: u.id
    }, /*#__PURE__*/React.createElement("td", {
      className: "num t-sm"
    }, u.uploaded_at), /*#__PURE__*/React.createElement("td", {
      className: "num t-sm"
    }, u.shipment_date || "–"), /*#__PURE__*/React.createElement("td", {
      className: "num t-strong"
    }, u.month), /*#__PURE__*/React.createElement("td", null, u.filename), /*#__PURE__*/React.createElement("td", {
      className: "r num"
    }, u.row_count), /*#__PURE__*/React.createElement("td", {
      className: "r num t-muted"
    }, u.replaced), /*#__PURE__*/React.createElement("td", null, u.uploaded_by), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
      className: "badge badge--" + (l && l.locked ? "bad" : "mute")
    }, l && l.locked ? "잠김" : "열림")));
  }))))));
}

/* ══════════════════ 수금계획 다운로드 ══════════════════ */

function CashPlan({
  data,
  dataView,
  notify
}) {
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
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          month,
          as_of_date: asOfDate,
          data_view: dataView,
          include_overdue: includeOverdue,
          include_bad: includeBad
        })
      });
      if (!res.ok) {
        let message = "수금계획을 생성하지 못했습니다.";
        try {
          message = (await res.json()).error || message;
        } catch (e) {/* ignore */}
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "MedPark_" + Number(month.slice(5, 7)) + "월_수금계획" + (includeOverdue ? "_미수포함" : "") + (includeBad ? "_부실포함" : "") + ".xlsx";
      link.click();
      URL.revokeObjectURL(url);
      notify(Number(month.slice(5, 7)) + "월 수금계획을 생성했습니다.");
    } catch (e) {
      notify(e.message, true);
    }
    setBusy(false);
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    title: "㈜메드파크 자금수지관리 수금계획"
  }, /*#__PURE__*/React.createElement("div", {
    className: "formrow"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "수금계획 기준월"
  }, /*#__PURE__*/React.createElement("select", {
    className: "select",
    value: month,
    onChange: e => setMonth(e.target.value)
  }, planMonths.map(m => /*#__PURE__*/React.createElement("option", {
    key: m,
    value: m
  }, Number(m.slice(5, 7)), "월 수금계획")))), /*#__PURE__*/React.createElement(Field, {
    label: "미수채권 조회기준일"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "date",
    value: asOfDate,
    onChange: e => setAsOfDate(e.target.value)
  }))), /*#__PURE__*/React.createElement("div", {
    className: "chiprow",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "chip",
    "aria-pressed": includeOverdue
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: includeOverdue,
    onChange: e => setIncludeOverdue(e.target.checked)
  }), " 미수채권 포함"), /*#__PURE__*/React.createElement("label", {
    className: "chip",
    "aria-pressed": includeBad
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: includeBad,
    onChange: e => setIncludeBad(e.target.checked)
  }), " 부실채권 포함")), /*#__PURE__*/React.createElement("div", {
    className: "alert alert--info",
    style: {
      margin: "12px 0"
    }
  }, "정상채권은 선택한 월의 수금대상 금액만 반영합니다. 미수채권은 입력한 조회기준일 현재 상태로 산정합니다."), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--primary",
    onClick: download,
    disabled: busy || !month || !asOfDate
  }, busy ? "엑셀 생성 중" : Number(month.slice(5, 7)) + "월 수금계획 다운로드")), /*#__PURE__*/React.createElement(Card, {
    title: "적용 기준"
  }, /*#__PURE__*/React.createElement("ul", {
    className: "template-steps"
  }, /*#__PURE__*/React.createElement("li", null, "본부는 ", /*#__PURE__*/React.createElement("b", null, "사업부"), ", 수금/지출은 ", /*#__PURE__*/React.createElement("b", null, "수금"), "으로 고정합니다."), /*#__PURE__*/React.createElement("li", null, "부서/팀과 집행항목은 덴탈·메디컬·에스테틱 사업부에 맞춰 자동 변환합니다."), /*#__PURE__*/React.createElement("li", null, "자금계획일·자금실행일은 해당 월 말일이며, 수금목표일이 있으면 그 날짜를 사용합니다."), /*#__PURE__*/React.createElement("li", null, "정상채권·미수채권·부실채권을 거래처별 별도 행으로 표시합니다."))));
}

/* ══════════════════ 계정·권한 관리 ══════════════════ */

function Users({
  data,
  notify,
  refresh
}) {
  const [sel, setSel] = useState(null);
  const [perms, setPerms] = useState([]);
  const [role, setRole] = useState("sales");
  const [newUser, setNewUser] = useState({
    username: "",
    name: "",
    title: "",
    role: "sales",
    biz_unit: "",
    password: ""
  });
  const setNew = key => e => setNewUser(v => ({
    ...v,
    [key]: e.target.value
  }));
  async function createAccount(e) {
    e.preventDefault();
    if (!newUser.username.trim() || !newUser.name.trim()) {
      notify("아이디와 이름을 입력하세요.", true);
      return;
    }
    if (newUser.password.length < 8) {
      notify("초기 비밀번호는 8자 이상으로 입력하세요.", true);
      return;
    }
    try {
      await api("/tf/ar/api/users", {
        method: "POST",
        body: newUser
      });
      notify(newUser.username + " 계정을 등록했습니다.");
      setNewUser({
        username: "",
        name: "",
        title: "",
        role: "sales",
        biz_unit: "",
        password: ""
      });
      await refresh();
    } catch (e) {
      notify(e.message, true);
    }
  }
  function choose(u) {
    setSel(u.username);
    setPerms(u.permissions || []);
    setRole(u.role);
  }
  function applyTemplate(r) {
    setRole(r);
    setPerms(data.meta.roles[r].perms);
  }
  async function save() {
    try {
      await api("/tf/ar/api/users/" + sel, {
        method: "PATCH",
        body: {
          role,
          permissions: perms
        }
      });
      notify(sel + " 권한을 저장했습니다.");
      await refresh();
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function toggleActive(u) {
    try {
      await api("/tf/ar/api/users/" + u.username, {
        method: "PATCH",
        body: {
          active: !u.active
        }
      });
      await refresh();
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function resetPassword(u) {
    const pw = prompt(u.username + " 의 새 비밀번호 (8자 이상)");
    if (!pw) return;
    if (pw.length < 8) {
      notify("8자 이상으로 입력하세요.", true);
      return;
    }
    try {
      await api("/tf/ar/api/users/" + u.username, {
        method: "PATCH",
        body: {
          password: pw
        }
      });
      notify("비밀번호를 변경했습니다.");
    } catch (e) {
      notify(e.message, true);
    }
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    title: "신규 계정 등록"
  }, /*#__PURE__*/React.createElement("form", {
    onSubmit: createAccount
  }, /*#__PURE__*/React.createElement("div", {
    className: "formrow"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "아이디*"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: newUser.username,
    onChange: setNew("username")
  })), /*#__PURE__*/React.createElement(Field, {
    label: "이름*"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: newUser.name,
    onChange: setNew("name")
  })), /*#__PURE__*/React.createElement(Field, {
    label: "직위"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: newUser.title,
    onChange: setNew("title")
  })), /*#__PURE__*/React.createElement(Field, {
    label: "역할"
  }, /*#__PURE__*/React.createElement("select", {
    className: "select",
    value: newUser.role,
    onChange: setNew("role")
  }, Object.entries(data.meta.roles).map(([key, r]) => /*#__PURE__*/React.createElement("option", {
    key: key,
    value: key
  }, r.label)))), /*#__PURE__*/React.createElement(Field, {
    label: "사업부"
  }, /*#__PURE__*/React.createElement("select", {
    className: "select",
    value: newUser.biz_unit,
    onChange: setNew("biz_unit")
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "전체/미지정"), data.meta.units.map(u => /*#__PURE__*/React.createElement("option", {
    key: u
  }, u)))), /*#__PURE__*/React.createElement(Field, {
    label: "초기 비밀번호*"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "password",
    minLength: "8",
    value: newUser.password,
    onChange: setNew("password")
  }))), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--primary",
    type: "submit"
  }, "계정 등록"))), /*#__PURE__*/React.createElement(Card, {
    title: "계정",
    flush: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "아이디"), /*#__PURE__*/React.createElement("th", null, "이름"), /*#__PURE__*/React.createElement("th", null, "직위"), /*#__PURE__*/React.createElement("th", null, "역할"), /*#__PURE__*/React.createElement("th", null, "사업부"), /*#__PURE__*/React.createElement("th", {
    className: "r"
  }, "권한 수"), /*#__PURE__*/React.createElement("th", null, "상태"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, data.users.map(u => /*#__PURE__*/React.createElement("tr", {
    key: u.username,
    style: {
      background: sel === u.username ? "var(--brand-soft)" : undefined
    }
  }, /*#__PURE__*/React.createElement("td", {
    className: "t-strong"
  }, u.username), /*#__PURE__*/React.createElement("td", null, u.name), /*#__PURE__*/React.createElement("td", {
    className: "t-muted"
  }, u.title || "–"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "badge badge--brand"
  }, data.meta.roles[u.role].label)), /*#__PURE__*/React.createElement("td", null, u.biz_unit || "–"), /*#__PURE__*/React.createElement("td", {
    className: "r num"
  }, (u.permissions || []).length, " / ", data.meta.permissions.length), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "badge badge--" + (u.active ? "ok" : "mute")
  }, u.active ? "사용" : "정지")), /*#__PURE__*/React.createElement("td", {
    className: "r"
  }, /*#__PURE__*/React.createElement("div", {
    className: "btnrow",
    style: {
      justifyContent: "flex-end"
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm",
    onClick: () => choose(u)
  }, "권한 편집"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm",
    onClick: () => resetPassword(u)
  }, "비밀번호"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm",
    onClick: () => toggleActive(u)
  }, u.active ? "정지" : "사용"))))))))), sel && /*#__PURE__*/React.createElement(Card, {
    title: sel + " 권한",
    actions: /*#__PURE__*/React.createElement("button", {
      className: "btn btn--sm btn--primary",
      onClick: save
    }, "변경 저장")
  }, /*#__PURE__*/React.createElement(Field, {
    label: "역할 템플릿"
  }, /*#__PURE__*/React.createElement("div", {
    className: "chiprow"
  }, Object.entries(data.meta.roles).map(([key, r]) => /*#__PURE__*/React.createElement("button", {
    key: key,
    className: "chip",
    "aria-pressed": role === key,
    onClick: () => applyTemplate(key)
  }, r.label)))), /*#__PURE__*/React.createElement("div", {
    className: "permgrid",
    style: {
      marginTop: 12
    }
  }, data.meta.permissions.map(p => /*#__PURE__*/React.createElement("label", {
    key: p.key
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: perms.includes(p.key),
    onChange: e => setPerms(e.target.checked ? [...perms, p.key] : perms.filter(x => x !== p.key))
  }), p.label)))));
}

/* ══════════════════ 사용 매뉴얼 ══════════════════ */

function Manual() {
  const steps = [["1", "조회기준 확인", "화면 상단에서 마감 기준 또는 최신 출고 포함 기준을 선택합니다."], ["2", "출고자료 반영", "관리자가 출고 데이터를 업로드하고 오류·합계·기준일을 확인합니다."], ["3", "거래처 관리", "회수기간·담당자·수금목표일·비고를 입력하고 미입력 거래처를 정리합니다."], ["4", "수금 등록·승인", "수금액과 수금일을 등록한 뒤 재무담당자가 승인하여 잔액에 반영합니다."], ["5", "현황 보고", "채권요약·결산회의 자료를 확인하고 PPT·PNG·Excel로 내려받습니다."]];
  const menus = [["대시보드", "전체 채권과 전일 수금 확인", "조회기준과 사업부를 먼저 선택"], ["채권요약현황", "사업부별 채권·수금 실적 보고", "결산자료는 PPT 또는 PNG 다운로드"], ["결산회의 미수채권", "잔액이 있는 미수채권만 회의자료로 확인", "사업부 선택 후 PPT·PNG 다운로드"], ["거래처별 현황", "회수기간·담당자·연체기간 조회 및 수정", "회수기간 미입력 필터로 누락 거래처 정리"], ["담당자별 채권현황", "담당자별 거래처와 채권잔액 확인", "미배정 거래처를 우선 점검"], ["수금 등록", "수금 등록·승인·반려", "거래처·금액·수금일 확인 후 등록"], ["수금목표 관리", "예정 수금액과 완료일 관리", "완료 시 실제 수금등록 여부도 확인"], ["출고 데이터 업로드", "아마란스 출고자료 반영", "월·출고기준일·합계 확인 후 확정"], ["수금계획 다운로드", "선택한 조회기준으로 계획서 생성", "다운로드 전 기준월 확인"], ["계정·권한 관리", "사용자 계정과 업무권한 설정", "관리자만 변경하고 퇴사자는 사용 정지"]];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    title: "처음 사용할 때 · 기본 업무 순서"
  }, /*#__PURE__*/React.createElement("div", {
    className: "manual-steps"
  }, steps.map(([no, title, text]) => /*#__PURE__*/React.createElement("div", {
    className: "manual-step",
    key: no
  }, /*#__PURE__*/React.createElement("b", null, no), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, title), /*#__PURE__*/React.createElement("small", null, text)))))), /*#__PURE__*/React.createElement(Card, {
    title: "메뉴별 사용법",
    flush: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "tablewrap"
  }, /*#__PURE__*/React.createElement("table", {
    className: "manual-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "메뉴"), /*#__PURE__*/React.createElement("th", null, "주요 기능"), /*#__PURE__*/React.createElement("th", null, "간단 사용법"))), /*#__PURE__*/React.createElement("tbody", null, menus.map(row => /*#__PURE__*/React.createElement("tr", {
    key: row[0]
  }, /*#__PURE__*/React.createElement("td", {
    className: "t-strong"
  }, row[0]), /*#__PURE__*/React.createElement("td", null, row[1]), /*#__PURE__*/React.createElement("td", null, row[2]))))))), /*#__PURE__*/React.createElement(Card, {
    title: "꼭 확인하세요"
  }, /*#__PURE__*/React.createElement("div", {
    className: "manual-notices"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "조회기준"), /*#__PURE__*/React.createElement("span", null, "보고 화면은 선택한 조회기준을 따르며, 수금·업로드 화면은 항상 최신 운영데이터를 사용합니다.")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "수금 승인"), /*#__PURE__*/React.createElement("span", null, "수금은 등록만으로 잔액이 줄지 않습니다. 재무담당자의 승인 후 반영됩니다.")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "미수 전환"), /*#__PURE__*/React.createElement("span", null, "거래가 종료된 정상채권은 채권 상세에서 미수채권으로 전환할 수 있습니다.")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "권한"), /*#__PURE__*/React.createElement("span", null, "계정 권한에 따라 사용할 수 없는 메뉴는 보이지 않을 수 있습니다.")))));
}

/* ══════════════════ 셸 ══════════════════ */

const SCREENS = [{
  key: "dashboard",
  label: "대시보드",
  perm: "dashboard_view",
  group: "현황"
}, {
  key: "summary",
  label: "채권요약현황",
  perm: "dashboard_view",
  group: "현황"
}, {
  key: "closing",
  label: "결산회의 미수채권",
  perm: "dashboard_view",
  group: "현황"
}, {
  key: "customers",
  label: "거래처별 현황",
  perm: "customer_view",
  group: "현황"
}, {
  key: "owners",
  label: "담당자별 채권현황",
  perm: "owner_view",
  group: "현황"
}, {
  key: "collections",
  label: "수금 등록",
  perm: "collection_register",
  group: "수금",
  alt: "collection_approve"
}, {
  key: "targets",
  label: "수금목표 관리",
  perm: "target_manage",
  group: "수금"
}, {
  key: "upload",
  label: "출고 데이터 업로드",
  perm: "upload_data",
  group: "관리"
}, {
  key: "cashplan",
  label: "수금계획 다운로드",
  perm: "data_export",
  group: "관리"
}, {
  key: "users",
  label: "계정·권한 관리",
  perm: "user_manage",
  group: "관리"
}, {
  key: "manual",
  label: "사용 매뉴얼",
  perm: null,
  group: "도움말"
}];
const REPORT_SCREENS = new Set(["dashboard", "summary", "closing", "customers", "owners", "targets", "cashplan"]);
function App() {
  const [user, setUser] = useState(undefined);
  const [data, setData] = useState(null);
  const [screen, setScreen] = useState("dashboard");
  const [preset, setPreset] = useState(null);
  const [toast, setToast] = useState(null);
  const [dataView, setDataView] = useState(() => localStorage.getItem("ar_data_view") || "combined");
  const notify = useCallback((message, bad) => {
    setToast({
      message,
      bad
    });
    setTimeout(() => setToast(null), 4000);
  }, []);
  const load = useCallback(async () => {
    const d = await api("/tf/ar/api/bootstrap");
    setData(d);
    setUser(d.user);
  }, []);
  useEffect(() => {
    api("/tf/ar/api/me").then(r => {
      if (r.user) load().catch(e => notify(e.message, true));else setUser(null);
    }).catch(() => setUser(null));
  }, [load, notify]);
  const can = useCallback(perm => !!(user && user.permissions.includes(perm)), [user]);
  const visible = useMemo(() => SCREENS.filter(s => !s.perm || can(s.perm) || s.alt && can(s.alt)), [can]);
  useEffect(() => {
    if (visible.length && !visible.some(s => s.key === screen)) setScreen(visible[0].key);
  }, [visible, screen]);
  useEffect(() => {
    if (!data) return;
    const options = data.meta.dashboard_views || [];
    if (!options.some(view => view.key === dataView)) {
      const fallback = options.some(view => view.key === "combined") ? "combined" : options[0] && options[0].key;
      if (fallback) setDataView(fallback);
    }
  }, [data, dataView]);
  useEffect(() => {
    localStorage.setItem("ar_data_view", dataView);
  }, [dataView]);
  if (user === undefined) {
    return /*#__PURE__*/React.createElement("div", {
      className: "boot"
    }, /*#__PURE__*/React.createElement("div", {
      className: "boot__mark"
    }, "MP"), /*#__PURE__*/React.createElement("p", {
      className: "boot__text"
    }, "불러오는 중입니다."));
  }
  if (user === null) return /*#__PURE__*/React.createElement(Login, {
    onDone: () => load()
  });
  if (!data) return /*#__PURE__*/React.createElement("div", {
    className: "boot"
  }, /*#__PURE__*/React.createElement("div", {
    className: "boot__mark"
  }, "MP"), /*#__PURE__*/React.createElement("p", {
    className: "boot__text"
  }, "데이터를 준비하고 있습니다."));
  const patchCustomer = c => setData(d => ({
    ...d,
    customers: d.customers.map(x => x.code === c.code ? {
      ...x,
      ...c
    } : x)
  }));
  const applyUpload = res => setData(d => ({
    ...d,
    customers: res.customers,
    uploads: res.uploads
  }));
  const current = SCREENS.find(s => s.key === screen) || SCREENS[0];
  const viewOptions = data.meta.dashboard_views || [{
    key: "combined",
    label: data.meta.reflection_label
  }];
  const reportScreen = REPORT_SCREENS.has(screen);
  const selectedView = viewOptions.find(view => view.key === dataView) || viewOptions[0];
  const effectiveView = selectedView.key;
  const reportData = effectiveView === "closing" ? {
    ...data,
    customers: data.dashboard_closing_customers || data.customers
  } : data;
  const screenData = reportScreen ? reportData : data;
  const groups = [...new Set(visible.map(s => s.group))];
  const pendingCount = data.collections.filter(c => c.state === "pending").length;
  async function signOut() {
    await api("/tf/ar/api/logout", {
      method: "POST"
    });
    setUser(null);
    setData(null);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "shell"
  }, /*#__PURE__*/React.createElement("nav", {
    className: "side"
  }, /*#__PURE__*/React.createElement("div", {
    className: "side__top"
  }, /*#__PURE__*/React.createElement("div", {
    className: "side__logo"
  }, /*#__PURE__*/React.createElement("span", null, "MP"), "채권관리")), /*#__PURE__*/React.createElement("div", {
    className: "side__nav"
  }, groups.map(g => /*#__PURE__*/React.createElement("div", {
    key: g
  }, /*#__PURE__*/React.createElement("div", {
    className: "side__group"
  }, g), visible.filter(s => s.group === g).map(s => /*#__PURE__*/React.createElement("button", {
    key: s.key,
    className: "side__item",
    "aria-current": screen === s.key,
    onClick: () => {
      setPreset(null);
      setScreen(s.key);
    }
  }, s.label, s.key === "collections" && pendingCount > 0 && /*#__PURE__*/React.createElement("small", null, pendingCount)))))), /*#__PURE__*/React.createElement("div", {
    className: "side__foot"
  }, "기준일 ", data.meta.today)), /*#__PURE__*/React.createElement("main", {
    className: "main"
  }, /*#__PURE__*/React.createElement("header", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, current.label), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "기준일 ", data.meta.today, " · ", reportScreen ? selectedView.label : "현재 운영데이터 기준"), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "거래처 ", screenData.customers.length, "곳 · 전체 채권 ", won(sum(screenData.customers, "balance")), "원")), /*#__PURE__*/React.createElement("div", {
    className: "spacer"
  }), reportScreen ? /*#__PURE__*/React.createElement("label", {
    className: "view-select"
  }, /*#__PURE__*/React.createElement("span", null, "조회기준"), /*#__PURE__*/React.createElement("select", {
    className: "select",
    value: effectiveView,
    onChange: e => setDataView(e.target.value)
  }, viewOptions.map(view => /*#__PURE__*/React.createElement("option", {
    key: view.key,
    value: view.key
  }, view.label)))) : /*#__PURE__*/React.createElement("span", {
    className: "badge badge--brand"
  }, "현재 운영데이터 기준"), /*#__PURE__*/React.createElement("div", {
    className: "who"
  }, /*#__PURE__*/React.createElement("b", null, user.name, user.title && " " + user.title), /*#__PURE__*/React.createElement("span", null, data.meta.roles[user.role].label, " · ", user.username)), /*#__PURE__*/React.createElement("button", {
    className: "btn btn--sm",
    onClick: signOut
  }, "로그아웃")), /*#__PURE__*/React.createElement("div", {
    className: "page"
  }, screen === "dashboard" && /*#__PURE__*/React.createElement(Dashboard, {
    data: reportData,
    setScreen: setScreen,
    setPreset: setPreset
  }), screen === "summary" && /*#__PURE__*/React.createElement(BondSummary, {
    data: reportData,
    notify: notify
  }), screen === "closing" && /*#__PURE__*/React.createElement(ClosingReceivables, {
    data: reportData,
    notify: notify
  }), screen === "customers" && /*#__PURE__*/React.createElement(Customers, {
    data: reportData,
    can: can,
    preset: preset,
    notify: notify,
    patchCustomer: patchCustomer
  }), screen === "owners" && /*#__PURE__*/React.createElement(Owners, {
    data: reportData
  }), screen === "collections" && /*#__PURE__*/React.createElement(Collections, {
    data: data,
    can: can,
    notify: notify,
    refresh: load
  }), screen === "targets" && /*#__PURE__*/React.createElement(Targets, {
    data: reportData,
    notify: notify,
    refresh: load
  }), screen === "upload" && /*#__PURE__*/React.createElement(Upload, {
    data: data,
    can: can,
    notify: notify,
    applyUpload: applyUpload,
    refresh: load
  }), screen === "cashplan" && /*#__PURE__*/React.createElement(CashPlan, {
    data: reportData,
    dataView: effectiveView,
    notify: notify
  }), screen === "users" && /*#__PURE__*/React.createElement(Users, {
    data: data,
    notify: notify,
    refresh: load
  }), screen === "manual" && /*#__PURE__*/React.createElement(Manual, null))), toast && /*#__PURE__*/React.createElement("div", {
    className: "toast" + (toast.bad ? " toast--bad" : "")
  }, toast.message));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
