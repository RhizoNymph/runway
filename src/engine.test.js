import { describe, it, expect } from "vitest";
import { valueAt, contribution401k, oneTimeAmount, simulate, annualTax, ymToAbs, absToYm } from "./engine.js";

const settings = (over = {}) => ({
  startMonth: "2026-01",
  horizonMonths: 12,
  filing: "single",
  stateTax: "none",
  stateRate: 0,
  useFlatTax: true,
  flatTaxRate: 0,
  inflation: 0,
  mode401k: "pct",
  pct401k: 0,
  limit401k: 24000,
  ytd401k: 0,
  matchPct: 0,
  matchCapPct: 0,
  ...over,
});

const model = (settingsOver = {}, over = {}) => ({
  settings: settings(settingsOver),
  incomes: [{ id: "i1", name: "Salary", amount: 10000, growth: 0, startMonth: "", endMonth: "", changes: [] }],
  expenses: [],
  oneTimes: [],
  accounts: [
    { id: "a1", name: "Cash", type: "cash", balance: 0, returnMode: "fixed", fixedRate: 0, contribMode: "none", contrib: 0, primary: true },
    { id: "a2", name: "401k", type: "retirement", balance: 0, returnMode: "fixed", fixedRate: 0, contribMode: "none", contrib: 0, primary: false },
  ],
  ...over,
});

describe("month arithmetic", () => {
  it("round-trips YYYY-MM through absolute months", () => {
    expect(absToYm(ymToAbs("2026-08"))).toBe("2026-08");
    expect(ymToAbs("")).toBeNull();
    expect(ymToAbs("2026-8")).toBeNull();
  });
});

describe("valueAt", () => {
  const start = ymToAbs("2026-01");
  it("returns the base amount inside the active window and 0 outside", () => {
    const item = { amount: 100, growth: 0, startMonth: "2026-03", endMonth: "2026-05", changes: [] };
    expect(valueAt(item, start, start)).toBe(0);
    expect(valueAt(item, ymToAbs("2026-03"), start)).toBe(100);
    expect(valueAt(item, ymToAbs("2026-05"), start)).toBe(100);
    expect(valueAt(item, ymToAbs("2026-06"), start)).toBe(0);
  });
  it("applies scheduled changes from their month onward", () => {
    const item = { amount: 100, growth: 0, startMonth: "", endMonth: "", changes: [{ id: "c", month: "2026-04", amount: 250 }] };
    expect(valueAt(item, ymToAbs("2026-03"), start)).toBe(100);
    expect(valueAt(item, ymToAbs("2026-04"), start)).toBe(250);
  });
  it("a delta change adds to the value in effect instead of replacing it", () => {
    const item = { amount: 100, growth: 0, startMonth: "", endMonth: "", changes: [{ id: "c", month: "2026-04", amount: 50, mode: "delta" }] };
    expect(valueAt(item, ymToAbs("2026-03"), start)).toBe(100);
    expect(valueAt(item, ymToAbs("2026-04"), start)).toBe(150);
    expect(valueAt(item, ymToAbs("2026-12"), start)).toBe(150);
  });
  it("negative deltas reduce, deltas stack, and a later set resets the base", () => {
    const item = {
      amount: 100, growth: 0, startMonth: "", endMonth: "", changes: [
        { id: "c1", month: "2026-04", amount: 50, mode: "delta" },
        { id: "c2", month: "2026-06", amount: -30, mode: "delta" },
        { id: "c3", month: "2026-08", amount: 90, mode: "set" },
        { id: "c4", month: "2026-10", amount: 10, mode: "delta" },
      ],
    };
    expect(valueAt(item, ymToAbs("2026-05"), start)).toBe(150);
    expect(valueAt(item, ymToAbs("2026-07"), start)).toBe(120);
    expect(valueAt(item, ymToAbs("2026-08"), start)).toBe(90);
    expect(valueAt(item, ymToAbs("2026-10"), start)).toBe(100);
  });
  it("growth compounds on top of a delta'd value", () => {
    const item = { amount: 100, growth: 10, startMonth: "", endMonth: "", changes: [{ id: "c", month: "2026-04", amount: 100, mode: "delta" }] };
    expect(valueAt(item, ymToAbs("2026-04"), start)).toBe(200);
    expect(valueAt(item, ymToAbs("2027-04"), start)).toBeCloseTo(220); // (100+100) × 1.1
  });
  it("compounds annual growth yearly", () => {
    const item = { amount: 100, growth: 10, startMonth: "", endMonth: "", changes: [] };
    expect(valueAt(item, start + 11, start)).toBe(100);
    expect(valueAt(item, start + 12, start)).toBeCloseTo(110);
    expect(valueAt(item, start + 24, start)).toBeCloseTo(121);
  });
  it("a set change compounds growth from its own month, not the sim start", () => {
    const item = { amount: 1000, growth: 10, startMonth: "", endMonth: "", changes: [{ id: "c", month: "2027-02", amount: 2000 }] };
    expect(valueAt(item, ymToAbs("2027-02"), start)).toBe(2000);        // exactly what was typed
    expect(valueAt(item, ymToAbs("2028-01"), start)).toBe(2000);        // under a year since the change
    expect(valueAt(item, ymToAbs("2028-02"), start)).toBeCloseTo(2200); // first anniversary of the change
  });
  it("a delta grows the value it produced from the delta month onward", () => {
    const item = { amount: 100, growth: 10, startMonth: "", endMonth: "", changes: [{ id: "c", month: "2026-07", amount: 100, mode: "delta" }] };
    expect(valueAt(item, ymToAbs("2026-07"), start)).toBe(200);         // base had no anniversary yet
    expect(valueAt(item, ymToAbs("2027-06"), start)).toBe(200);
    expect(valueAt(item, ymToAbs("2027-07"), start)).toBeCloseTo(220);
  });
  it("a delta lands on the grown value when the base already compounded", () => {
    const item = { amount: 100, growth: 10, startMonth: "", endMonth: "", changes: [{ id: "c", month: "2027-03", amount: 50, mode: "delta" }] };
    expect(valueAt(item, ymToAbs("2027-03"), start)).toBeCloseTo(160);  // 110 grown base + 50
    expect(valueAt(item, ymToAbs("2028-03"), start)).toBeCloseTo(176);  // 160 × 1.1 a year after the delta
  });
  it("a disabled item contributes nothing", () => {
    const item = { amount: 100, growth: 0, startMonth: "", endMonth: "", changes: [], disabled: true };
    expect(valueAt(item, start, start)).toBe(0);
  });
  it("a yearly item lands only in its charged month, every year", () => {
    const item = { amount: 1200, growth: 0, startMonth: "", endMonth: "", changes: [], cadence: "yearly", cadenceMonth: 3 };
    expect(valueAt(item, ymToAbs("2026-02"), start)).toBe(0);
    expect(valueAt(item, ymToAbs("2026-03"), start)).toBe(1200);
    expect(valueAt(item, ymToAbs("2026-04"), start)).toBe(0);
    expect(valueAt(item, ymToAbs("2027-03"), start)).toBe(1200);
  });
  it("yearly items respect windows, growth, and scheduled changes", () => {
    const item = {
      amount: 1000, growth: 10, startMonth: "", endMonth: "2027-06", changes: [{ id: "c", month: "2028-01", amount: 500 }],
      cadence: "yearly", cadenceMonth: 1,
    };
    expect(valueAt(item, ymToAbs("2026-01"), start)).toBe(1000);
    expect(valueAt(item, ymToAbs("2027-01"), start)).toBeCloseTo(1100); // one year of growth
    expect(valueAt(item, ymToAbs("2028-01"), start)).toBe(0);           // past the end window
  });
  it("an out-of-range charged month behaves as January", () => {
    const item = { amount: 600, growth: 0, startMonth: "", endMonth: "", changes: [], cadence: "yearly", cadenceMonth: 0 };
    expect(valueAt(item, ymToAbs("2026-01"), start)).toBe(600);
    expect(valueAt(item, ymToAbs("2026-02"), start)).toBe(0);
  });
});

describe("contribution401k", () => {
  it("pct mode contributes a share of gross, clamped by the remaining limit", () => {
    const s = settings({ pct401k: 10 });
    expect(contribution401k(s, 10000, 0, 0)).toBe(1000);
    expect(contribution401k(s, 10000, 23500, 6)).toBe(500);
    expect(contribution401k(s, 10000, 24000, 11)).toBe(0);
  });
  it("maxEven spreads the remaining limit over the remaining calendar months", () => {
    const s = settings({ mode401k: "maxEven" });
    expect(contribution401k(s, 10000, 0, 0)).toBe(2000);      // Jan: 24000/12
    expect(contribution401k(s, 100000, 0, 7)).toBe(4800);     // Aug start: 24000/5
    expect(contribution401k(s, 10000, 23000, 11)).toBe(1000); // Dec: all that's left
    expect(contribution401k(s, 10000, 12000, 6)).toBe(2000);  // Jul, half done: 12000/6
  });
  it("maxEven is clamped to gross", () => {
    const s = settings({ mode401k: "maxEven" });
    expect(contribution401k(s, 1500, 0, 0)).toBe(1500);
    expect(contribution401k(s, 0, 0, 0)).toBe(0);
  });
});

describe("simulate — 401(k) even split", () => {
  it("hits the annual limit exactly over a full calendar year", () => {
    const r = simulate(model({ mode401k: "maxEven" }), 0);
    const total = r.rows.reduce((t, m) => t + m.c401, 0);
    expect(total).toBeCloseTo(24000);
    r.rows.forEach((m) => expect(m.c401).toBeCloseTo(2000));
  });
  it("resets the YTD counter each January", () => {
    const r = simulate(model({ mode401k: "maxEven", horizonMonths: 13 }), 0);
    expect(r.rows[12].c401).toBeCloseTo(2000);
    expect(r.rows[12].label).toMatch(/^Jan/);
  });
  it("still maxes the limit on a mid-year start", () => {
    const r = simulate(model({ mode401k: "maxEven", startMonth: "2026-08", horizonMonths: 5 }), 0);
    r.rows.forEach((m) => expect(m.c401).toBeCloseTo(4800)); // 24000 / 5
    expect(r.rows.reduce((t, m) => t + m.c401, 0)).toBeCloseTo(24000);
  });
  it("catches up after a month where gross could not cover the even share", () => {
    const m = model({ mode401k: "maxEven" });
    m.incomes[0].amount = 1000;
    m.incomes[0].changes = [{ id: "c", month: "2026-02", amount: 50000 }];
    const r = simulate(m, 0);
    expect(r.rows[0].c401).toBeCloseTo(1000); // clamped to gross
    expect(r.rows[1].c401).toBeCloseTo(23000 / 11);
    expect(r.rows.reduce((t, x) => t + x.c401, 0)).toBeCloseTo(24000);
  });
  it("honors money already contributed this year, in the first calendar year only", () => {
    const r = simulate(model({ mode401k: "maxEven", startMonth: "2026-08", horizonMonths: 17, ytd401k: 14000 }), 0);
    r.rows.slice(0, 5).forEach((m) => expect(m.c401).toBeCloseTo(2000)); // (24000−14000)/5
    expect(r.rows[5].label).toMatch(/^Jan/);
    expect(r.rows.slice(5).reduce((t, m) => t + m.c401, 0)).toBeCloseTo(24000); // full limit again
  });
  it("bases the employer match on the effective contribution percentage", () => {
    // gross 10000, c401 2000 → 20% effective, capped at 6%, matched at 50%
    const r = simulate(model({ mode401k: "maxEven", matchPct: 50, matchCapPct: 6 }), 0);
    expect(r.rows[0].match).toBeCloseTo(10000 * 0.06 * 0.5);
  });
  it("matches less when the effective percentage is under the cap", () => {
    // gross 50000, c401 2000 → 4% effective < 6% cap → match = 50000 × 4% × 50%
    const m = model({ mode401k: "maxEven", matchPct: 50, matchCapPct: 6 });
    m.incomes[0].amount = 50000;
    const r = simulate(m, 0);
    expect(r.rows[0].match).toBeCloseTo(50000 * 0.04 * 0.5);
  });
  it("routes contributions into the retirement account", () => {
    const r = simulate(model({ mode401k: "maxEven" }), 0);
    expect(r.rows[11].retire).toBeCloseTo(24000);
  });
});

describe("simulate — pct mode is unchanged", () => {
  it("contributes pct of gross and matches the nominal election", () => {
    const r = simulate(model({ pct401k: 10, matchPct: 50, matchCapPct: 6 }), 0);
    expect(r.rows[0].c401).toBeCloseTo(1000);
    expect(r.rows[0].match).toBeCloseTo(10000 * 0.06 * 0.5);
  });
  it("stops contributing at the annual limit", () => {
    const m = model({ pct401k: 50, limit401k: 23500 });
    const r = simulate(m, 0);
    // 5000/mo → limit hit in month 5 (4×5000 + 3500), then 0
    expect(r.rows[4].c401).toBeCloseTo(3500);
    expect(r.rows[5].c401).toBe(0);
    expect(r.rows.reduce((t, x) => t + x.c401, 0)).toBeCloseTo(23500);
  });
  it("counts money already contributed this year against the limit", () => {
    const r = simulate(model({ pct401k: 50, limit401k: 23500, ytd401k: 20000 }), 0);
    expect(r.rows[0].c401).toBeCloseTo(3500);
    expect(r.rows[1].c401).toBe(0);
  });
  it("treats a model without mode401k or ytd401k as before", () => {
    const m = model({ pct401k: 10 });
    delete m.settings.mode401k;
    delete m.settings.ytd401k;
    const r = simulate(m, 0);
    expect(r.rows[0].c401).toBeCloseTo(1000);
  });
});

describe("simulate — calendar-year tax", () => {
  it("a steady full year pays exactly the annual tax, spread evenly", () => {
    const m = model({ useFlatTax: false });
    const r = simulate(m, 0);
    const expected = annualTax(120000, 0, m.settings);
    expect(r.rows.reduce((t, x) => t + x.tax, 0)).toBeCloseTo(expected);
    r.rows.forEach((x) => expect(x.tax).toBeCloseTo(expected / 12));
  });
  it("a mid-year raise is taxed on the year's actual total, not each month annualized", () => {
    const m = model({ useFlatTax: false });
    m.incomes[0].changes = [{ id: "c", month: "2026-07", amount: 20000 }];
    const r = simulate(m, 0);
    const annual = 6 * 10000 + 6 * 20000;
    const expected = annualTax(annual, 0, m.settings);
    expect(r.rows.reduce((t, x) => t + x.tax, 0)).toBeCloseTo(expected);
    // withholding follows each month's share of the year's income
    expect(r.rows[0].tax).toBeCloseTo(expected * (10000 / annual));
    expect(r.rows[11].tax).toBeCloseTo(expected * (20000 / annual));
  });
  it("annualizes a partial first year and deducts prior-YTD 401(k) once", () => {
    const m = model({ useFlatTax: false, mode401k: "maxEven", startMonth: "2026-09", horizonMonths: 4, ytd401k: 12000 });
    const r = simulate(m, 0);
    // Sep–Dec at 10000 → estimated 120000 full-year gross; 401(k) deduction is
    // the 12000 contributed in-sim plus the 12000 already contributed = 24000.
    // The four simulated months withhold their share of the year's bill.
    const expected = annualTax(120000, 24000, m.settings) * (40000 / 120000);
    expect(r.rows.reduce((t, x) => t + x.tax, 0)).toBeCloseTo(expected);
  });
  it("each calendar year is taxed separately", () => {
    const m = model({ useFlatTax: false, horizonMonths: 24 });
    m.incomes[0].changes = [{ id: "c", month: "2027-01", amount: 30000 }];
    const r = simulate(m, 0);
    expect(r.rows.slice(0, 12).reduce((t, x) => t + x.tax, 0)).toBeCloseTo(annualTax(120000, 0, m.settings));
    expect(r.rows.slice(12).reduce((t, x) => t + x.tax, 0)).toBeCloseTo(annualTax(360000, 0, m.settings));
  });
});

describe("simulate — post-tax income", () => {
  const partner = (amount, over = {}) => ({
    id: "i2", name: "Partner take-home", amount, growth: 0, startMonth: "", endMonth: "", changes: [], afterTax: true, ...over,
  });
  it("lands in net untouched by flat tax and stays out of gross", () => {
    const m = model({ flatTaxRate: 50 });
    m.incomes.push(partner(2000));
    const r = simulate(m, 0);
    expect(r.rows[0].gross).toBe(10000);
    expect(r.rows[0].tax).toBe(5000);
    expect(r.rows[0].postTax).toBe(2000);
    expect(r.rows[0].net).toBe(7000); // 10000 − 5000 + 2000
  });
  it("stays out of progressive tax and the 401(k)/match base", () => {
    const m = model({ useFlatTax: false, mode401k: "maxEven", matchPct: 50, matchCapPct: 6 });
    m.incomes.push(partner(5000));
    const r = simulate(m, 0);
    expect(r.rows.reduce((t, x) => t + x.tax, 0)).toBeCloseTo(annualTax(120000, 24000, m.settings));
    expect(r.rows[0].c401).toBeCloseTo(2000);
    expect(r.rows[0].match).toBeCloseTo(10000 * 0.06 * 0.5);
  });
  it("alone it funds the household but no pre-tax machinery", () => {
    const m = model({ mode401k: "maxEven" });
    m.incomes = [partner(5000)];
    const r = simulate(m, 0);
    expect(r.rows[0].gross).toBe(0);
    expect(r.rows[0].c401).toBe(0);
    expect(r.rows[0].tax).toBe(0);
    expect(r.rows[0].net).toBe(5000);
  });
  it("honors windows and scheduled changes like any line item", () => {
    const m = model({ flatTaxRate: 0 });
    m.incomes.push(partner(2000, { startMonth: "2026-07" }));
    const r = simulate(m, 0);
    expect(r.rows[5].postTax).toBe(0);
    expect(r.rows[6].postTax).toBe(2000);
  });
});

describe("simulate — yearly expenses", () => {
  it("charges the annual amount in the right months only", () => {
    const m = model({}, {
      expenses: [{ id: "e1", name: "Insurance (annual)", amount: 1200, growth: 0, startMonth: "", endMonth: "", changes: [], cadence: "yearly", cadenceMonth: 3 }],
    });
    const r = simulate(m, 0);
    expect(r.rows[1].exp).toBe(0);    // Feb
    expect(r.rows[2].exp).toBe(1200); // Mar
    expect(r.rows[3].exp).toBe(0);    // Apr
    expect(r.rows.reduce((t, x) => t + x.exp, 0)).toBe(1200);
  });
});

describe("percentage deposits are a share of the month's leftover", () => {
  const acct = (id, over = {}) => ({
    id, name: id, type: "cash", balance: 0, returnMode: "fixed", fixedRate: 0,
    contribMode: "none", contrib: 0, primary: false, capAmount: 0, overflowTo: "", ...over,
  });
  const living = { id: "e1", name: "Living", amount: 4000, growth: 0, startMonth: "", endMonth: "", changes: [] };
  const base = (accounts, over = {}) => model({}, { expenses: [living], accounts, ...over });
  // gross 10000, flat tax 0%, no 401k → net 10000; minus 4000 → leftover 6000/mo

  it("transfers pct of leftover (net + one-times − expenses), not of net", () => {
    const r = simulate(base([
      acct("a1", { primary: true }),
      acct("a2", { type: "invest", contribMode: "pct", contrib: 50 }),
    ]), 0);
    expect(r.rows[0].transfers).toBe(3000); // 50% of 6000, not 5000 (50% of net)
    expect(r.rows[0].cash).toBe(3000);
    expect(r.rows[0].invest).toBe(3000);
  });

  it("counts one-time flows in the leftover base", () => {
    const r = simulate(base(
      [acct("a1", { primary: true }), acct("a2", { type: "invest", contribMode: "pct", contrib: 50 })],
      { oneTimes: [{ id: "o1", name: "Bonus", month: "2026-01", amount: 1000, kind: "in" }] },
    ), 0);
    expect(r.rows[0].transfers).toBe(3500); // 50% of (6000 + 1000)
  });

  it("transfers nothing in a shortfall month", () => {
    const r = simulate(base([
      acct("a1", { primary: true, balance: 20000 }),
      acct("a2", { type: "invest", contribMode: "pct", contrib: 50 }),
    ], { expenses: [{ ...living, amount: 12000 }] }), 0); // leftover −2000
    expect(r.rows[0].transfers).toBe(0);
    expect(r.rows[0].invest).toBe(0);
    expect(r.rows[0].cash).toBe(18000);
  });

  it("fixed-dollar deposits are unchanged and not throttled", () => {
    const r = simulate(base([
      acct("a1", { primary: true, balance: 20000 }),
      acct("a2", { type: "invest", contribMode: "fixed", contrib: 1000 }),
    ], { expenses: [{ ...living, amount: 12000 }] }), 0);
    expect(r.rows[0].transfers).toBe(1000);
    expect(r.rows[0].cash).toBe(17000); // 20000 − 2000 shortfall − 1000 transfer
  });
});

describe("leftover overflow between accounts", () => {
  const acct = (id, over = {}) => ({
    id, name: id, type: "cash", balance: 0, returnMode: "fixed", fixedRate: 0,
    contribMode: "none", contrib: 0, primary: false, capAmount: 0, overflowTo: "", ...over,
  });
  const living = { id: "e1", name: "Living", amount: 4000, growth: 0, startMonth: "", endMonth: "", changes: [] };
  // gross 10000, flat tax 0%, no 401k → net 10000; minus 4000 → surplus 6000/mo

  it("fills the primary to its cap, then routes the excess to the destination", () => {
    const m = model({}, {
      expenses: [living],
      accounts: [
        acct("a1", { primary: true, capAmount: 10000, overflowTo: "a2" }),
        acct("a2", { type: "invest" }),
      ],
    });
    const r = simulate(m, 0);
    expect(r.rows[0].cash).toBe(6000);
    expect(r.rows[0].invest).toBe(0);
    expect(r.rows[1].cash).toBe(10000);
    expect(r.rows[1].invest).toBe(2000);
    expect(r.rows[3].cash).toBe(10000);
    expect(r.rows[3].invest).toBe(14000);
  });

  it("moves a starting balance already above the cap in the first month", () => {
    const m = model({}, {
      expenses: [living],
      accounts: [
        acct("a1", { primary: true, balance: 50000, capAmount: 10000, overflowTo: "a2" }),
        acct("a2", { type: "invest" }),
      ],
    });
    const r = simulate(m, 0);
    expect(r.rows[0].cash).toBe(10000);
    expect(r.rows[0].invest).toBe(46000);
  });

  it("does nothing without a cap or a valid destination", () => {
    const free = simulate(model({}, {
      expenses: [living],
      accounts: [acct("a1", { primary: true, capAmount: 10000, overflowTo: "" }), acct("a2", { type: "invest" })],
    }), 0);
    expect(free.rows[2].cash).toBe(18000);
    const gone = simulate(model({}, {
      expenses: [living],
      accounts: [acct("a1", { primary: true, capAmount: 10000, overflowTo: "nope" }), acct("a2", { type: "invest" })],
    }), 0);
    expect(gone.rows[2].cash).toBe(18000);
    expect(gone.rows[2].invest).toBe(0);
  });

  it("cascades through a chain of caps in the same month", () => {
    const m = model({}, {
      expenses: [living],
      accounts: [
        acct("a1", { primary: true, capAmount: 1000, overflowTo: "a2" }),
        acct("a2", { capAmount: 2000, overflowTo: "a3" }),
        acct("a3", { type: "invest" }),
      ],
    });
    const r = simulate(m, 0);
    expect(r.rows[0].cash).toBe(3000);   // a1 at 1000 + a2 at 2000
    expect(r.rows[0].invest).toBe(3000); // remainder of the 6000 surplus
  });

  it("does not overflow in a month that stays under the cap", () => {
    const m = model({}, {
      expenses: [{ ...living, amount: 12000 }], // surplus −2000
      accounts: [
        acct("a1", { primary: true, balance: 5000, capAmount: 10000, overflowTo: "a2" }),
        acct("a2", { type: "invest" }),
      ],
    });
    const r = simulate(m, 0);
    expect(r.rows[0].cash).toBe(3000);
    expect(r.rows[0].invest).toBe(0);
  });

  it("pulls back from the overflow destination instead of going negative", () => {
    const m = model({}, {
      expenses: [{ ...living, amount: 13000 }], // surplus −3000/mo
      accounts: [
        acct("a1", { primary: true, balance: 1000, capAmount: 20000, overflowTo: "a2" }),
        acct("a2", { type: "invest", balance: 10000 }),
      ],
    });
    const r = simulate(m, 0);
    expect(r.rows[0].cash).toBe(0);      // −2000 covered by the brokerage
    expect(r.rows[0].invest).toBe(8000);
    expect(r.rows[2].invest).toBe(2000); // keeps draining monthly
    expect(r.rows[2].cash).toBe(0);
    expect(r.rows[3].invest).toBe(0);    // waterfall exhausted...
    expect(r.rows[3].cash).toBe(-1000);  // ...only now does cash go negative
  });

  it("goes negative only once the whole waterfall is drained", () => {
    const m = model({}, {
      expenses: [{ ...living, amount: 13000 }], // surplus −3000/mo
      accounts: [
        acct("a1", { primary: true, balance: 0, capAmount: 20000, overflowTo: "a2" }),
        acct("a2", { type: "invest", balance: 4000 }),
      ],
    });
    const r = simulate(m, 0);
    expect(r.rows[0].cash).toBe(0);
    expect(r.rows[0].invest).toBe(1000);
    expect(r.rows[1].cash).toBe(-2000);  // 1000 left in brokerage, 3000 short
    expect(r.rows[1].invest).toBe(0);
    expect(r.minCash).toBeLessThan(0);
  });

  it("walks the chain to backfill when the first destination is empty", () => {
    const m = model({}, {
      expenses: [{ ...living, amount: 13000 }], // surplus −3000
      accounts: [
        acct("a1", { primary: true, capAmount: 1000, overflowTo: "a2" }),
        acct("a2", { capAmount: 2000, overflowTo: "a3" }),
        acct("a3", { type: "invest", balance: 50000 }),
      ],
    });
    const r = simulate(m, 0);
    expect(r.rows[0].cash).toBe(0);       // a1 pulled through a2 from a3
    expect(r.rows[0].invest).toBe(47000);
  });

  it("a start month keeps the sweep dormant until it arrives", () => {
    const m = model({}, {
      expenses: [living], // surplus 6000/mo
      accounts: [
        acct("a1", { primary: true, balance: 20000, capAmount: 10000, overflowTo: "a2", overflowStart: "2026-03" }),
        acct("a2", { type: "invest" }),
      ],
    });
    const r = simulate(m, 0);
    expect(r.rows[0].cash).toBe(26000);  // above cap, but link not active yet
    expect(r.rows[0].invest).toBe(0);
    expect(r.rows[1].cash).toBe(32000);
    expect(r.rows[2].cash).toBe(10000);  // March: swept to the cap
    expect(r.rows[2].invest).toBe(28000);
  });

  it("the backstop is dormant before the start month too", () => {
    const m = model({}, {
      expenses: [{ ...living, amount: 13000 }], // surplus −3000/mo
      accounts: [
        acct("a1", { primary: true, balance: 1000, capAmount: 20000, overflowTo: "a2", overflowStart: "2026-02" }),
        acct("a2", { type: "invest", balance: 10000 }),
      ],
    });
    const r = simulate(m, 0);
    expect(r.rows[0].cash).toBe(-2000);  // January: link off, no pull
    expect(r.rows[0].invest).toBe(10000);
    expect(r.rows[1].cash).toBe(0);      // February: backstop covers the hole
    expect(r.rows[1].invest).toBe(5000);
  });

  it("refillToCap tops the account back up to its cap, not just to zero", () => {
    const m = model({}, {
      expenses: [{ ...living, amount: 13000 }], // surplus −3000/mo
      accounts: [
        acct("a1", { primary: true, balance: 20000, capAmount: 20000, overflowTo: "a2", refillToCap: true }),
        acct("a2", { type: "invest", balance: 10000 }),
      ],
    });
    const r = simulate(m, 0);
    expect(r.rows[0].cash).toBe(20000);  // dip to 17000 refilled from the brokerage
    expect(r.rows[0].invest).toBe(7000);
    expect(r.rows[2].invest).toBe(1000);
    expect(r.rows[3].cash).toBe(18000);  // only 1000 left to pull
    expect(r.rows[3].invest).toBe(0);
  });
  it("refillToCap walks the chain and stays dormant before overflowStart", () => {
    const m = model({}, {
      expenses: [{ ...living, amount: 13000 }], // surplus −3000/mo
      accounts: [
        acct("a1", { primary: true, balance: 5000, capAmount: 5000, overflowTo: "a2", refillToCap: true, overflowStart: "2026-02" }),
        acct("a2", { capAmount: 1000, overflowTo: "a3", balance: 1000, refillToCap: true }),
        acct("a3", { type: "invest", balance: 50000 }),
      ],
    });
    const r = simulate(m, 0);
    expect(r.rows[0].cash).toBe(3000);   // January: link dormant, no refill (5000 − 3000 + a2's 1000)
    expect(r.rows[1].cash).toBe(6000);   // February: both refilled to their caps
    expect(r.rows[1].invest).toBe(44000);
  });
  it("stays negative when there is no overflow link to pull from", () => {
    const m = model({}, {
      expenses: [{ ...living, amount: 13000 }],
      accounts: [
        acct("a1", { primary: true, balance: 1000 }),
        acct("a2", { type: "invest", balance: 10000 }),
      ],
    });
    const r = simulate(m, 0);
    expect(r.rows[0].cash).toBe(-2000);
    expect(r.rows[0].invest).toBe(10000);
  });
});

describe("one-time items linked to an expense line", () => {
  const rent = { id: "rent", name: "Rent", amount: 2000, growth: 0, startMonth: "", endMonth: "", changes: [{ id: "c", month: "2026-03", amount: 4000 }] };

  it("oneTimeAmount resolves a fixed amount as before", () => {
    const o = { month: "2026-03", amount: 5000, kind: "out" };
    expect(oneTimeAmount(o, [rent], ymToAbs("2026-03"), ymToAbs("2026-01"))).toBe(5000);
  });
  it("oneTimeAmount resolves a percentage of the linked item's value that month", () => {
    const o = { month: "2026-03", basis: "pct", itemId: "rent", pct: 200, amount: 0, kind: "out" };
    const start = ymToAbs("2026-01");
    expect(oneTimeAmount(o, [rent], ymToAbs("2026-03"), start)).toBe(8000); // uses the changed rent
    expect(oneTimeAmount(o, [rent], ymToAbs("2026-02"), start)).toBe(4000); // pre-change rent
  });
  it("a linked item whose expense is missing contributes nothing", () => {
    const o = { month: "2026-03", basis: "pct", itemId: "gone", pct: 200, amount: 999, kind: "out" };
    expect(oneTimeAmount(o, [rent], ymToAbs("2026-03"), ymToAbs("2026-01"))).toBe(0);
  });
  it("a disabled one-time contributes nothing", () => {
    const o = { month: "2026-03", amount: 5000, kind: "out", disabled: true };
    expect(oneTimeAmount(o, [rent], ymToAbs("2026-03"), ymToAbs("2026-01"))).toBe(0);
  });
  it("a linked one-time follows its expense to zero when the expense is disabled", () => {
    const o = { month: "2026-03", basis: "pct", itemId: "rent", pct: 200, amount: 0, kind: "out" };
    const offRent = { ...rent, disabled: true };
    expect(oneTimeAmount(o, [offRent], ymToAbs("2026-03"), ymToAbs("2026-01"))).toBe(0);
  });
  it("simulate books the linked amount as that month's outflow", () => {
    const m = model({}, {
      expenses: [rent],
      oneTimes: [{ id: "o1", name: "Deposit + first month", month: "2026-03", basis: "pct", itemId: "rent", pct: 200, amount: 0, kind: "out" }],
    });
    const r = simulate(m, 0);
    expect(r.rows[2].outflow).toBeCloseTo(8000);
    expect(r.rows[1].outflow).toBe(0);
  });
  it("the linked amount follows a trial rent, as the solver relies on", () => {
    const trialRent = { ...rent, changes: [{ id: "s", month: "2026-03", amount: 3000 }] };
    const m = model({}, {
      expenses: [trialRent],
      oneTimes: [{ id: "o1", name: "Deposit + first month", month: "2026-03", basis: "pct", itemId: "rent", pct: 200, amount: 0, kind: "out" }],
    });
    const r = simulate(m, 0);
    expect(r.rows[2].outflow).toBeCloseTo(6000);
  });
});
