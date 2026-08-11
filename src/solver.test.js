import { describe, it, expect } from "vitest";
import { trialItem, solveMax } from "./solver.js";
import { ymToAbs } from "./engine.js";

/* flat 0% tax, no 401(k), one cash account: net = gross, so affordability
   falls out of prefix sums of (income − rent) against the starting balance */
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
const rentItem = (over = {}) => ({
  id: "rent", name: "Rent", amount: 2000, growth: 0, startMonth: "", endMonth: "", changes: [], ...over,
});
const model = (rent, over = {}) => ({
  settings: settings(over.settings),
  incomes: [{ id: "i1", name: "Salary", amount: 10000, growth: 0, startMonth: "", endMonth: "", changes: [] }],
  expenses: [rent],
  oneTimes: [],
  accounts: [{
    id: "a1", name: "Cash", type: "cash", balance: 0, returnMode: "fixed", fixedRate: 0,
    contribMode: "none", contrib: 0, primary: true, capAmount: 0, overflowTo: "",
  }],
  ...over,
});
const opts = (over = {}) => ({
  itemId: "rent", fromMonth: "2026-01", cashFloor: 0, endTarget: 0, useEndTarget: false, rate: 0, ...over,
});

describe("trialItem", () => {
  it("replaces only a change dated exactly at fromMonth and keeps the rest", () => {
    const item = rentItem({
      changes: [
        { id: "a", month: "2026-01", amount: 1111 },
        { id: "b", month: "2026-07", amount: -500, mode: "delta" },
        { id: "c", month: "2026-10", amount: 900 },
      ],
    });
    const t = trialItem(item, "2026-01", 3000);
    expect(t.changes.map((c) => c.id).sort()).toEqual(["b", "c", "solve"]);
    expect(t.changes.find((c) => c.id === "solve")).toMatchObject({ month: "2026-01", amount: 3000, mode: "set" });
  });
  it("leaves the item's window untouched", () => {
    const t = trialItem(rentItem({ endMonth: "2026-06" }), "2026-01", 3000);
    expect(t.endMonth).toBe("2026-06");
  });
});

describe("solveMax", () => {
  it("finds the rent that exactly exhausts the monthly surplus at the floor", () => {
    // income 10000, balance 0, floor 0 → any rent above 10000 dips negative
    const s = solveMax(model(rentItem()), opts());
    expect(s.value).toBeCloseTo(10000, 1);
    expect(s.binding).toBe("cash floor");
  });

  it("keeps a delta scheduled after fromMonth in force during the solve", () => {
    // +2000 delta from July: months 7-12 pay v+2000, so the year's total
    // budget 120000 = 6v + 6(v+2000) → v = 9000 (10000 if the delta were dropped)
    const rent = rentItem({ changes: [{ id: "d", month: "2026-07", amount: 2000, mode: "delta" }] });
    const s = solveMax(model(rent), opts());
    expect(s.value).toBeCloseTo(9000, 1);
  });

  it("keeps a later set change, which ends the solved amount's influence", () => {
    // rent pinned to 3000 from July; a 30000 hit in September must clear.
    // Cash by Sep: 6(10000−v) + 3·7000 − 30000 ≥ 0 → v ≤ 8500
    // (dropping the set change would force v ≤ 6666)
    const rent = rentItem({ changes: [{ id: "s7", month: "2026-07", amount: 3000 }] });
    const m = model(rent, { oneTimes: [{ id: "o1", name: "hit", month: "2026-09", amount: 30000, kind: "out" }] });
    const s = solveMax(m, opts());
    expect(s.value).toBeCloseTo(8500, 1);
  });

  it("respects the item's end month instead of clearing it", () => {
    // rent ends in June; the September hit is paid from rent-free months.
    // Only the June prefix binds: v ≤ 10000 (clearing endMonth would give 6666)
    const rent = rentItem({ endMonth: "2026-06" });
    const m = model(rent, { oneTimes: [{ id: "o1", name: "hit", month: "2026-09", amount: 30000, kind: "out" }] });
    const s = solveMax(m, opts());
    expect(s.value).toBeCloseTo(10000, 1);
  });

  it("reports infeasibility when even zero fails the floor", () => {
    const s = solveMax(model(rentItem()), opts({ cashFloor: 1000000 }));
    expect(s.infeasible).toBe(true);
    expect(s.reason).toBe("cash");
  });

  it("honors the ending net-worth target as the binding constraint", () => {
    // end total = 12(10000 − v) ≥ 60000 → v ≤ 5000
    const s = solveMax(model(rentItem()), opts({ useEndTarget: true, endTarget: 60000 }));
    expect(s.value).toBeCloseTo(5000, 1);
    expect(s.binding).toBe("savings target");
  });
});
