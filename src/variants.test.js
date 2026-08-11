import { describe, it, expect } from "vitest";
import { applyVariant, variantMetrics } from "./variants.js";
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
  it("does not mutate the input model and ignores unknown items", () => {
    const m = model([expense("food", 885)]);
    const before = JSON.stringify(m);
    const v = applyVariant(m, { id: "v1", tweaks: [{ id: "t1", itemId: "nope", mode: "set", amount: 1, startMonth: "" }] });
    expect(JSON.stringify(m)).toBe(before);
    expect(v.expenses[0].changes).toHaveLength(0);
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
