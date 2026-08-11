import { describe, it, expect } from "vitest";
import { applyVariant, variantMetrics, withApplied } from "./variants.js";
import { valueAt, ymToAbs } from "./engine.js";

const settings = (over = {}) => ({
  startMonth: "2026-01",
  horizonMonths: 12,
  filing: "single",
  stateTax: "none",
  stateRate: 0,
  useFlatTax: true,
  flatTaxRate: 0,
  mode401k: "pct",
  pct401k: 0,
  limit401k: 24000,
  ytd401k: 0,
  matchPct: 0,
  matchCapPct: 0,
  ...over,
});
const expense = (id, amount, over = {}) => ({
  id, name: id, amount, growth: 0, startMonth: "", endMonth: "", changes: [], ...over,
});
const model = (expenses, over = {}) => ({
  settings: settings(over.settings),
  incomes: [{ id: "i1", name: "Salary", amount: 10000, growth: 0, startMonth: "", endMonth: "", changes: [] }],
  expenses,
  oneTimes: [],
  accounts: [{
    id: "a1", name: "Cash", type: "cash", balance: 0, returnMode: "fixed", fixedRate: 0,
    contribMode: "none", contrib: 0, primary: true, capAmount: 0, overflowTo: "",
  }],
  ...over,
});
const start = ymToAbs("2026-01");

describe("applyVariant", () => {
  it("a set tweak replaces the amount from the sim start by default", () => {
    const m = model([expense("food", 885)]);
    const v = applyVariant(m, { id: "v1", name: "cook", tweaks: [{ id: "t1", itemId: "food", mode: "set", amount: 400, startMonth: "" }] });
    expect(valueAt(v.expenses[0], start, start)).toBe(400);
    expect(valueAt(v.expenses[0], start + 11, start)).toBe(400);
  });
  it("a delta tweak shifts the value in effect and honors its start month", () => {
    const m = model([expense("rent", 3000)]);
    const v = applyVariant(m, { id: "v1", tweaks: [{ id: "t1", itemId: "rent", mode: "delta", amount: -500, startMonth: "2026-04" }] });
    expect(valueAt(v.expenses[0], ymToAbs("2026-03"), start)).toBe(3000);
    expect(valueAt(v.expenses[0], ymToAbs("2026-04"), start)).toBe(2500);
  });
  it("composes with the item's own schedule; a same-month set tweak wins", () => {
    const m = model([expense("rent", 3000, { changes: [{ id: "c", month: "2026-04", amount: 3500 }] })]);
    const v = applyVariant(m, { id: "v1", tweaks: [{ id: "t1", itemId: "rent", mode: "set", amount: 2000, startMonth: "2026-04" }] });
    expect(valueAt(v.expenses[0], ymToAbs("2026-03"), start)).toBe(3000);
    expect(valueAt(v.expenses[0], ymToAbs("2026-04"), start)).toBe(2000);
  });
  it("a delta tweak follows valueAt's rules: a later set change resets it", () => {
    const m = model([expense("rent", 3000, { changes: [{ id: "c", month: "2026-04", amount: 3500 }] })]);
    const v = applyVariant(m, { id: "v1", tweaks: [{ id: "t1", itemId: "rent", mode: "delta", amount: -500, startMonth: "" }] });
    expect(valueAt(v.expenses[0], start, start)).toBe(2500);              // 3000 − 500
    expect(valueAt(v.expenses[0], ymToAbs("2026-04"), start)).toBe(3500); // the set resets the base
  });
  it("a variant start month is the default for tweaks without their own", () => {
    const m = model([expense("food", 885), expense("fun", 400)]);
    const v = applyVariant(m, {
      id: "v1", startMonth: "2026-04",
      tweaks: [
        { id: "t1", itemId: "food", mode: "set", amount: 400, startMonth: "" },
        { id: "t2", itemId: "fun", mode: "delta", amount: -100, startMonth: "" },
      ],
    });
    expect(valueAt(v.expenses[0], ymToAbs("2026-03"), start)).toBe(885);
    expect(valueAt(v.expenses[0], ymToAbs("2026-04"), start)).toBe(400);
    expect(valueAt(v.expenses[1], ymToAbs("2026-04"), start)).toBe(300);
  });
  it("the variant start pushes earlier tweak months but keeps later ones", () => {
    const m = model([expense("early", 100), expense("late", 100)]);
    const v = applyVariant(m, {
      id: "v1", startMonth: "2026-06",
      tweaks: [
        { id: "t1", itemId: "early", mode: "set", amount: 50, startMonth: "2026-02" }, // pushed to Jun
        { id: "t2", itemId: "late", mode: "set", amount: 50, startMonth: "2026-09" },  // stays Sep
      ],
    });
    expect(valueAt(v.expenses[0], ymToAbs("2026-05"), start)).toBe(100);
    expect(valueAt(v.expenses[0], ymToAbs("2026-06"), start)).toBe(50);
    expect(valueAt(v.expenses[1], ymToAbs("2026-08"), start)).toBe(100);
    expect(valueAt(v.expenses[1], ymToAbs("2026-09"), start)).toBe(50);
  });
  it("does not mutate the input model and ignores unknown items", () => {
    const m = model([expense("food", 885)]);
    const before = JSON.stringify(m);
    const v = applyVariant(m, { id: "v1", tweaks: [{ id: "t1", itemId: "nope", mode: "set", amount: 1, startMonth: "" }] });
    expect(JSON.stringify(m)).toBe(before);
    expect(v.expenses[0].changes).toHaveLength(0);
  });
});

describe("withApplied", () => {
  it("overlays only checked variants, in list order", () => {
    const m = {
      ...model([expense("food", 885)]),
      variants: [
        { id: "v1", applied: true, tweaks: [{ id: "t1", itemId: "food", mode: "set", amount: 400, startMonth: "" }] },
        { id: "v2", tweaks: [{ id: "t1", itemId: "food", mode: "set", amount: 100, startMonth: "" }] },
        { id: "v3", applied: true, tweaks: [{ id: "t1", itemId: "food", mode: "delta", amount: -50, startMonth: "" }] },
      ],
    };
    const eff = withApplied(m);
    expect(valueAt(eff.expenses[0], start, start)).toBe(350); // set 400, then −50; v2 unchecked
    expect(valueAt(m.expenses[0], start, start)).toBe(885);   // raw model untouched
  });
  it("is the identity without variants", () => {
    const m = model([expense("food", 885)]);
    expect(withApplied(m)).toBe(m);
  });
});

describe("variantMetrics", () => {
  it("separates the pre-overflow trough from the post-cap minimum", () => {
    // dips to 7000 by March, then the cap starting April skims cash to 2000
    const m = model(
      [expense("living", 11000, { changes: [{ id: "c", month: "2026-04", amount: 5000 }] })],
      {
        accounts: [
          {
            id: "a1", name: "Cash", type: "cash", balance: 10000, returnMode: "fixed", fixedRate: 0,
            contribMode: "none", contrib: 0, primary: true,
            capAmount: 2000, overflowTo: "a2", overflowStart: "2026-04",
          },
          {
            id: "a2", name: "Broker", type: "invest", balance: 0, returnMode: "fixed", fixedRate: 0,
            contribMode: "none", contrib: 0, primary: false, capAmount: 0, overflowTo: "",
          },
        ],
      },
    );
    const x = variantMetrics(m, 0);
    expect(x.trough).toBe(7000);
    expect(x.troughAbs).toBe(ymToAbs("2026-03"));
    expect(x.minCash).toBe(2000);
    expect(x.firstExp).toBe(11000);
  });
  it("falls back to the overall minimum when no link has a start month", () => {
    const m = model([expense("living", 11000)]);
    const x = variantMetrics(m, 0);
    expect(x.trough).toBe(x.minCash);
  });
});
