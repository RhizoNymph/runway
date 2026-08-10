import { describe, it, expect } from "vitest";
import { parseCheckpoints, modelDiff, compareModels } from "./core.js";
import { ymToAbs } from "../../src/engine.js";

const mkModel = (over = {}, settingsOver = {}) => ({
  settings: {
    startMonth: "2026-08", horizonMonths: 24, filing: "single", stateTax: "none",
    stateRate: 0, useFlatTax: true, flatTaxRate: 0, inflation: 0,
    mode401k: "pct", pct401k: 0, limit401k: 23500, ytd401k: 0, matchPct: 0, matchCapPct: 0,
    milestones: [], ...settingsOver,
  },
  incomes: [{ id: "i1", name: "Salary", amount: 10000, growth: 0, startMonth: "", endMonth: "", changes: [] }],
  expenses: [{ id: "e1", name: "Living", amount: 4000, growth: 0, startMonth: "", endMonth: "", changes: [] }],
  oneTimes: [],
  accounts: [
    { id: "a1", name: "Cash", type: "cash", balance: 0, returnMode: "fixed", fixedRate: 0, contribMode: "none", contrib: 0, primary: true, capAmount: 0, overflowTo: "" },
  ],
  scenarios: [
    { id: "s1", name: "Bear", rate: 0, color: "#000" },
    { id: "s2", name: "Base", rate: 0, color: "#000" },
  ],
  solver: { itemId: null, fromMonth: "", cashFloor: 0, endTarget: 0, useEndTarget: false },
  ...over,
});

describe("parseCheckpoints", () => {
  const m = mkModel(); // Aug 2026 + 24 months → ends Jul 2028

  it("parses YYYY-MM, month offsets, and 'end'; sorted, unique, in range", () => {
    // offset 12 = 12th simulated month = Jul 2027, same as the YYYY-MM token;
    // out-of-range entries (1999-01, offset 999) are dropped
    const pts = parseCheckpoints("2027-07, 12, end, 2027-07, 1999-01, 999", m);
    expect(pts).toEqual([ymToAbs("2027-07"), ymToAbs("2028-07")]);
  });

  it("defaults to milestones + evenly spaced fills + end", () => {
    const mm = mkModel({}, { milestones: ["2027-07"] });
    const pts = parseCheckpoints(null, mm);
    expect(pts[0]).toBe(ymToAbs("2027-07"));
    expect(pts[pts.length - 1]).toBe(ymToAbs("2028-07"));
    expect(pts.length).toBe(5); // milestone + 3 fills + end
  });

  it("defaults to quartiles without milestones", () => {
    const pts = parseCheckpoints(null, m);
    expect(pts.length).toBe(4);
    expect(pts[pts.length - 1]).toBe(ymToAbs("2028-07"));
  });

  it("ignores milestones outside the horizon", () => {
    const mm = mkModel({}, { milestones: ["2035-01"] });
    const pts = parseCheckpoints(null, mm);
    expect(pts.length).toBe(4); // falls back to quartiles
  });
});

describe("modelDiff", () => {
  it("reports settings changes, item field changes, and adds/removes by id", () => {
    const a = mkModel();
    const b = mkModel();
    b.settings.pct401k = 10;
    b.expenses = [
      { ...a.expenses[0], amount: 4500 },
      { id: "e2", name: "Gym", amount: 50, growth: 0, startMonth: "", endMonth: "", changes: [] },
    ];
    b.incomes = [];
    const d = modelDiff(a, b);
    expect(d.settings).toEqual([{ key: "pct401k", from: 0, to: 10 }]);
    expect(d.items).toContainEqual({ section: "expenses", id: "e1", name: "Living", kind: "changed", fields: [{ field: "amount", from: 4000, to: 4500 }] });
    expect(d.items).toContainEqual({ section: "expenses", id: "e2", name: "Gym", kind: "added" });
    expect(d.items).toContainEqual({ section: "incomes", id: "i1", name: "Salary", kind: "removed" });
  });

  it("is empty for identical models", () => {
    const d = modelDiff(mkModel(), mkModel());
    expect(d.settings).toEqual([]);
    expect(d.items).toEqual([]);
    expect(d.solver).toEqual([]);
  });
});

describe("compareModels", () => {
  it("computes checkpoint deltas and events for a changed expense", () => {
    const a = mkModel();
    const b = mkModel();
    b.expenses = [{ ...a.expenses[0], amount: 3900 }]; // spend 100 less → +100/mo
    const r = compareModels(a, b, { at: "12,end" });
    expect(r.scenario).toEqual({ name: "Base", rate: 0 });
    expect(r.warnings).toEqual([]);
    expect(r.checkpoints).toHaveLength(2);
    expect(r.checkpoints[0].delta.cash).toBeCloseTo(1200);  // 12 months × 100
    expect(r.checkpoints[1].delta.total).toBeCloseTo(2400); // 24 months × 100
    expect(r.events.endTotal.delta).toBeCloseTo(2400);
    expect(r.events.minCash.delta).toBeCloseTo(100); // min is month 1 in both
  });

  it("flags structural differences as warnings", () => {
    const a = mkModel();
    const b = mkModel({}, { horizonMonths: 36 });
    b.scenarios = [{ id: "s1", name: "Bear", rate: 0, color: "#000" }, { id: "s2", name: "Base", rate: 5, color: "#000" }];
    const r = compareModels(a, b, { at: "end" });
    expect(r.warnings.some((w) => w.includes("horizon"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("rate"))).toBe(true);
  });

  it("reports first-negative cash months", () => {
    const a = mkModel();
    const b = mkModel();
    b.expenses = [{ ...a.expenses[0], amount: 11000 }]; // −1000/mo from $0
    const r = compareModels(a, b, { at: "end" });
    expect(r.events.firstNegative.baseline).toBeNull();
    expect(r.events.firstNegative.variant?.ym).toBe("2026-08");
  });
});
