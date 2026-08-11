import { describe, it, expect } from "vitest";
import { axisValues, setItemAmount, runSensitivity } from "./sensitivity.js";

/* flat 0% tax, no 401(k), one cash account, no growth: net = income, so
   max rent and end totals are simple arithmetic over the grid */
const settings = {
  startMonth: "2026-01", horizonMonths: 12, filing: "single", stateTax: "none", stateRate: 0,
  useFlatTax: true, flatTaxRate: 0, mode401k: "pct", pct401k: 0, limit401k: 24000, ytd401k: 0,
  matchPct: 0, matchCapPct: 0,
};
const model = (over = {}) => ({
  settings,
  incomes: [{ id: "sal", name: "Salary", amount: 10000, growth: 0, startMonth: "", endMonth: "", changes: [] }],
  expenses: [
    { id: "rent", name: "Rent", amount: 2000, growth: 0, startMonth: "", endMonth: "", changes: [] },
    { id: "other", name: "Other", amount: 0, growth: 0, startMonth: "", endMonth: "", changes: [] },
  ],
  oneTimes: [{ id: "bonus", name: "Bonus", month: "2026-06", amount: 0, kind: "in" }],
  accounts: [{
    id: "a1", name: "Cash", type: "cash", balance: 0, returnMode: "fixed", fixedRate: 0,
    contribMode: "none", contrib: 0, primary: true, capAmount: 0, overflowTo: "",
  }],
  ...over,
});
const solve = { itemId: "rent", fromMonth: "2026-01", cashFloor: 0, endTarget: 0, useEndTarget: false, rate: 0 };

describe("axisValues", () => {
  it("builds an inclusive linspace", () => {
    expect(axisValues({ min: 0, max: 100, steps: 5 })).toEqual([0, 25, 50, 75, 100]);
  });
  it("degenerates to a single point when the range is empty", () => {
    expect(axisValues({ min: 50, max: 50, steps: 5 })).toEqual([50]);
  });
});

describe("setItemAmount", () => {
  it("replaces the amount for each kind without mutating", () => {
    const m = model();
    const inc = setItemAmount(m, { kind: "income", itemId: "sal" }, 7);
    const exp = setItemAmount(m, { kind: "expense", itemId: "other" }, 8);
    const one = setItemAmount(m, { kind: "onetime", itemId: "bonus" }, 9);
    expect(inc.incomes[0].amount).toBe(7);
    expect(exp.expenses[1].amount).toBe(8);
    expect(one.oneTimes[0].amount).toBe(9);
    expect(m.incomes[0].amount).toBe(10000);
    expect(m.expenses[1].amount).toBe(0);
    expect(m.oneTimes[0].amount).toBe(0);
  });
});

describe("runSensitivity", () => {
  it("one variable: max rent tracks income, end tracks the scheduled plan", () => {
    const r = runSensitivity(model(), { a: { kind: "income", itemId: "sal", min: 4000, max: 10000, steps: 3 }, solve, rate: 0 });
    expect(r.aValues).toEqual([4000, 7000, 10000]);
    expect(r.bValues).toEqual([null]);
    r.cells.forEach((c, i) => {
      expect(c.maxRent).toBeCloseTo(r.aValues[i], 1);          // floor 0 → rent up to net income
      expect(c.end).toBeCloseTo(12 * (r.aValues[i] - 2000), 1); // plan keeps rent 2000
    });
  });
  it("two variables: the second axis shifts both outputs cell by cell", () => {
    const r = runSensitivity(model(), {
      a: { kind: "income", itemId: "sal", min: 5000, max: 10000, steps: 2 },
      b: { kind: "expense", itemId: "other", min: 0, max: 1000, steps: 2 },
      solve, rate: 0,
    });
    expect(r.bValues).toEqual([0, 1000]);
    const cell = (i, j) => r.cells[j * r.aValues.length + i];
    expect(cell(0, 0).maxRent).toBeCloseTo(5000, 1);
    expect(cell(0, 1).maxRent).toBeCloseTo(4000, 1);           // 1000 of "Other" crowds rent out
    expect(cell(1, 1).end).toBeCloseTo(12 * (10000 - 2000 - 1000), 1);
  });
  it("marks infeasible cells with NaN max rent", () => {
    const r = runSensitivity(model(), {
      a: { kind: "income", itemId: "sal", min: 0, max: 1000, steps: 2 },
      solve: { ...solve, cashFloor: 1e9 }, rate: 0,
    });
    r.cells.forEach((c) => expect(Number.isNaN(c.maxRent)).toBe(true));
  });
});
