/* ────────────────────────────── helpers ────────────────────────────── */

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return isNaN(n) ? 0 : n;
};
export const ymToAbs = (ym) => {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
};
export const absToYm = (a) => `${Math.floor(a / 12)}-${String((a % 12) + 1).padStart(2, "0")}`;
export const absLabel = (a) => `${MON[a % 12]} ${String(Math.floor(a / 12)).slice(2)}`;

/* ────────────────────────────── tax model ────────────────────────────── */
/* Approximate 2025 figures. Editable via the flat-rate override. */

const FED = {
  single: {
    std: 15000,
    b: [[11925, 0.1], [48475, 0.12], [103350, 0.22], [197300, 0.24], [250525, 0.32], [626350, 0.35], [Infinity, 0.37]],
  },
  married: {
    std: 30000,
    b: [[23850, 0.1], [96950, 0.12], [206700, 0.22], [394600, 0.24], [501050, 0.32], [751600, 0.35], [Infinity, 0.37]],
  },
};
const CAT = {
  single: {
    std: 5540,
    b: [[10756, 0.01], [25499, 0.02], [40245, 0.04], [55866, 0.06], [70606, 0.08], [360659, 0.093], [432787, 0.103], [721314, 0.113], [Infinity, 0.123]],
  },
  married: {
    std: 11080,
    b: [[21512, 0.01], [50998, 0.02], [80490, 0.04], [111732, 0.06], [141212, 0.08], [721318, 0.093], [865574, 0.103], [1442628, 0.113], [Infinity, 0.123]],
  },
};

export function progressive(income, brackets) {
  let t = 0, prev = 0;
  for (const [cap, rate] of brackets) {
    if (income <= prev) break;
    t += (Math.min(income, cap) - prev) * rate;
    prev = cap;
  }
  return t;
}

export function annualTax(gross, preTax, s) {
  const filing = s.filing === "married" ? "married" : "single";
  const fedTaxable = Math.max(0, gross - preTax - FED[filing].std);
  const fed = progressive(fedTaxable, FED[filing].b);

  let state = 0;
  if (s.stateTax === "CA") {
    const caTaxable = Math.max(0, gross - preTax - CAT[filing].std);
    state = progressive(caTaxable, CAT[filing].b) + gross * 0.012; // + SDI
  } else if (s.stateTax === "custom") {
    state = Math.max(0, gross - preTax) * (num(s.stateRate) / 100);
  }

  const ss = Math.min(gross, 176100) * 0.062;
  const medThresh = filing === "married" ? 250000 : 200000;
  const med = gross * 0.0145 + Math.max(0, gross - medThresh) * 0.009;

  return fed + state + ss + med;
}

/* ────────────────────────────── simulation ────────────────────────────── */

export function valueAt(item, abs, startAbs) {
  if (item.disabled) return 0;
  const s = ymToAbs(item.startMonth);
  const e = ymToAbs(item.endMonth);
  if (s !== null && abs < s) return 0;
  if (e !== null && abs > e) return 0;
  if (item.cadence === "yearly") {
    // amount is per occurrence, charged once a year in cadenceMonth (1–12)
    const cm = num(item.cadenceMonth);
    const charged = cm >= 1 && cm <= 12 ? cm : 1;
    if ((abs % 12) + 1 !== charged) return 0;
  }
  const g = num(item.growth) / 100;
  const grown = (val, from, to) => (g ? val * Math.pow(1 + g, Math.max(0, Math.floor((to - from) / 12))) : val);
  const cs = (item.changes || [])
    .filter((c) => ymToAbs(c.month) !== null)
    .sort((a, b) => ymToAbs(a.month) - ymToAbs(b.month));
  // "set" (default) replaces the amount; "delta" adds to the value in effect.
  // Growth anniversaries count from the month the value was last set: the
  // base grows from the sim start, a changed value from its change month
  // (a delta applies to the grown value and restarts the clock).
  let v = num(item.amount);
  let since = startAbs;
  for (const c of cs) {
    const cm = ymToAbs(c.month);
    if (abs < cm) break;
    v = c.mode === "delta" ? grown(v, since, cm) + num(c.amount) : num(c.amount);
    since = cm;
  }
  return grown(v, since, abs);
}

const FALLBACK_ACCOUNT = {
  id: "fallback", name: "Cash", type: "cash", balance: 0,
  returnMode: "fixed", fixedRate: 0, contribMode: "none", contrib: 0, primary: true,
};

/* Monthly pre-tax 401(k) contribution.
   "pct" mode: a percentage of gross. "maxEven" mode: whatever remains of the
   annual limit, split evenly over the months left in the calendar year
   (monthIdx is 0 for January) — so a mid-year start, a prior-YTD balance, or
   a lean month all still land exactly on the limit by December. Both modes
   are clamped to gross and to what remains of the annual limit. */
export function contribution401k(settings, gross, ytd401k, monthIdx) {
  const limit = num(settings.limit401k);
  const remaining = limit - ytd401k;
  const raw = settings.mode401k === "maxEven"
    ? remaining / (12 - monthIdx)
    : gross * (num(settings.pct401k) / 100);
  return Math.max(0, Math.min(raw, remaining, gross));
}

/* A one-time item's dollar amount in a given month. basis "pct" links it to
   an expense line: pct% of that line's value in that month. */
export function oneTimeAmount(o, expenses, abs, startAbs) {
  if (o.disabled) return 0;
  if (o.basis === "pct") {
    const it = expenses.find((e) => e.id === o.itemId);
    return it ? valueAt(it, abs, startAbs) * (num(o.pct) / 100) : 0;
  }
  return num(o.amount);
}

export function simulate(model, annualReturnPct) {
  const { settings, incomes, expenses, oneTimes } = model;
  const accounts = model.accounts.length ? model.accounts : [FALLBACK_ACCOUNT];
  const startAbs = ymToAbs(settings.startMonth) ?? new Date().getFullYear() * 12;
  const N = Math.max(1, Math.min(600, Math.round(num(settings.horizonMonths))));

  /* pass 1: income, 401(k), and employer match are independent of account
     balances — compute them per month up front so tax can be assessed on
     calendar-year totals rather than each month annualized. */
  const months = [];
  let ytd401k = 0;
  let lastYear = null;
  for (let k = 0; k < N; k++) {
    const abs = startAbs + k;
    const year = Math.floor(abs / 12);
    // YTD resets each January; the first (possibly partial) calendar year
    // starts from whatever was already contributed before the simulation.
    if (year !== lastYear) {
      ytd401k = year === Math.floor(startAbs / 12) ? num(settings.ytd401k) : 0;
      lastYear = year;
    }

    // `afterTax: true` marks income that is already taxed on someone else's
    // return (an unmarried partner's take-home, say): it skips this filer's
    // tax, FICA, and 401(k)/match math and lands straight in net.
    let gross = 0, postTax = 0;
    for (const i of incomes) {
      const v = valueAt(i, abs, startAbs);
      if (i.afterTax) postTax += v; else gross += v;
    }

    // pre-tax retirement contribution
    const c401 = contribution401k(settings, gross, ytd401k, abs % 12);
    ytd401k += c401;

    // employer match: in pct mode the nominal election is matched; in maxEven
    // mode there is no election, so match what was actually contributed.
    const electedPct = settings.mode401k === "maxEven"
      ? (gross > 0 ? (c401 / gross) * 100 : 0)
      : num(settings.pct401k);
    const matchedPct = Math.min(electedPct, num(settings.matchCapPct));
    const match = gross * (matchedPct / 100) * (num(settings.matchPct) / 100);

    months.push({ abs, year, gross, postTax, c401, match, tax: 0 });
  }

  /* tax: flat mode is a straight percentage per month. Otherwise each
     calendar year is taxed on its actual simulated totals — a partial first
     or last year annualized by scaling its months up to twelve, prior-YTD
     401(k) joining the first year's deduction — and every month withholds
     its share of the year's bill in proportion to its gross. */
  if (settings.useFlatTax) {
    for (const m of months) m.tax = m.gross * (num(settings.flatTaxRate) / 100);
  } else {
    const byYear = new Map();
    for (const m of months) {
      if (!byYear.has(m.year)) byYear.set(m.year, []);
      byYear.get(m.year).push(m);
    }
    const firstYear = Math.floor(startAbs / 12);
    const limit = num(settings.limit401k);
    for (const [year, ms] of byYear) {
      const sumGross = ms.reduce((t, m) => t + m.gross, 0);
      const sumPre = ms.reduce((t, m) => t + m.c401, 0);
      const scale = ms.length < 12 ? 12 / ms.length : 1;
      const estGross = sumGross * scale;
      let estPre = year === firstYear ? sumPre + num(settings.ytd401k) : sumPre * scale;
      if (limit > 0) estPre = Math.min(estPre, limit);
      const yearTax = annualTax(estGross, estPre, settings);
      for (const m of ms) m.tax = estGross > 0 ? yearTax * (m.gross / estGross) : 0;
    }
  }

  /* pass 2: cash flows, transfers, overflow, and balances */
  let bal = accounts.map((a) => num(a.balance));
  const primaryIdx = Math.max(0, accounts.findIndex((a) => a.primary));
  const retireIdx = accounts.findIndex((a) => a.type === "retirement");

  const rows = [];
  let minCash = Infinity, minCashAbs = startAbs, firstNegative = null;

  for (let k = 0; k < N; k++) {
    const { abs, year, gross, postTax, c401, match, tax } = months[k];
    const net = gross - c401 - tax + postTax;
    const exp = expenses.reduce((t, i) => t + valueAt(i, abs, startAbs), 0);

    let inflow = 0, outflow = 0;
    for (const o of oneTimes) {
      if (ymToAbs(o.month) === abs) {
        const amt = oneTimeAmount(o, expenses, abs, startAbs);
        if (o.kind === "in") inflow += amt;
        else outflow += amt;
      }
    }

    // deliberate transfers into non-primary, non-retirement accounts.
    // "pct" deposits are a share of the month's leftover (before transfers),
    // so they self-throttle to zero in shortfall months; "fixed" deposits
    // are unconditional.
    const leftover = net + inflow - exp - outflow;
    let transfers = 0;
    const perAccount = accounts.map((a, idx) => {
      if (idx === primaryIdx || a.type === "retirement" || a.contribMode === "none") return 0;
      const c = a.contribMode === "pct" ? leftover * (num(a.contrib) / 100) : num(a.contrib);
      return Math.max(0, c);
    });
    perAccount.forEach((c) => (transfers += c));

    const surplus = net + inflow - exp - outflow - transfers;

    // apply flows
    perAccount.forEach((c, idx) => { if (c) bal[idx] += c; });
    bal[primaryIdx] += surplus;
    if (retireIdx >= 0) bal[retireIdx] += c401 + match;

    // overflow: an account holding more than its cap passes the excess to
    // its destination; bounded passes let chains cascade but stop cycles
    const linkOf = (i) => {
      const cap = num(accounts[i].capAmount);
      const to = accounts[i].overflowTo;
      if (!(cap > 0) || !to) return -1;
      const os = ymToAbs(accounts[i].overflowStart);
      if (os !== null && abs < os) return -1; // link dormant until its start month
      const dst = accounts.findIndex((x) => x.id === to);
      return dst === i ? -1 : dst;
    };
    for (let pass = 0; pass < accounts.length; pass++) {
      let moved = false;
      for (let i = 0; i < accounts.length; i++) {
        const dst = linkOf(i);
        const cap = num(accounts[i].capAmount);
        if (dst < 0 || bal[i] <= cap) continue;
        bal[dst] += bal[i] - cap;
        bal[i] = cap;
        moved = true;
      }
      if (!moved) break;
    }

    // backstop: an account driven under its floor pulls back along its
    // overflow chain. The floor is $0 by default — just enough to avoid
    // going negative — or the cap itself when `refillToCap` is set, which
    // keeps the account topped up ("self-healing") while the chain has money.
    for (let i = 0; i < accounts.length; i++) {
      const want = accounts[i].refillToCap && linkOf(i) >= 0 ? num(accounts[i].capAmount) : 0;
      if (bal[i] >= want) continue;
      const seen = new Set([i]);
      for (let j = linkOf(i); bal[i] < want && j >= 0 && !seen.has(j); j = linkOf(j)) {
        const pull = Math.min(want - bal[i], Math.max(0, bal[j]));
        bal[j] -= pull;
        bal[i] += pull;
        seen.add(j);
      }
    }

    // growth
    bal = bal.map((b, idx) => {
      const a = accounts[idx];
      const r = a.returnMode === "fixed" ? num(a.fixedRate) : num(annualReturnPct);
      return b * (1 + r / 100 / 12);
    });

    const cash = accounts.reduce((t, a, i) => t + (a.type === "cash" ? bal[i] : 0), 0);
    const invest = accounts.reduce((t, a, i) => t + (a.type === "invest" ? bal[i] : 0), 0);
    const retire = accounts.reduce((t, a, i) => t + (a.type === "retirement" ? bal[i] : 0), 0);
    const total = cash + invest + retire;

    if (cash < minCash) { minCash = cash; minCashAbs = abs; }
    if (cash < 0 && firstNegative === null) firstNegative = abs;

    rows.push({
      abs, label: absLabel(abs), year,
      gross, postTax, tax, c401, match, net, exp, inflow, outflow, transfers, surplus,
      cash, invest, retire, total,
      saved: surplus + transfers + c401 + match,
      balances: [...bal],
    });
  }

  return { rows, minCash, minCashAbs, firstNegative, endTotal: rows[rows.length - 1]?.total ?? 0 };
}
