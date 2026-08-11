/* Pure affordability solver: bisection over a trial amount for one expense
   line, rerunning `simulate` per probe. React-free — src/App.jsx owns the
   panel that drives it. */

import { simulate, valueAt, ymToAbs, absToYm, num } from "./engine.js";

/* The trial: the candidate amount lands as a "set" change at fromMonth.
   Everything else the item schedules stays in force — deltas stack on top
   of the candidate, a later "set" ends its influence, and the start/end
   window still applies. Only a change dated exactly fromMonth is replaced
   by the candidate. */
export function trialItem(item, fromMonth, amount) {
  const fromAbs = ymToAbs(fromMonth);
  const kept = (item.changes || []).filter((c) => ymToAbs(c.month) !== fromAbs);
  return { ...item, changes: [...kept, { id: "solve", month: fromMonth, amount, mode: "set" }] };
}

/* Finds the largest amount for the item (from fromMonth onward, subject to
   its remaining schedule) that keeps every month's cash at or above the
   floor — and, optionally, the ending net worth at or above a target.
   Returns the same shape the solver panel renders. */
export function solveMax(model, { itemId, fromMonth, cashFloor, endTarget, useEndTarget, rate }) {
  const item = model.expenses.find((e) => e.id === itemId);
  if (!item) return null;
  const startAbs = ymToAbs(model.settings.startMonth) ?? new Date().getFullYear() * 12;
  const fromM = fromMonth || absToYm(startAbs);
  const fromAbs = ymToAbs(fromM) ?? startAbs;
  const floor = num(cashFloor);
  const target = num(endTarget);

  const test = (v) => {
    const expenses = model.expenses.map((e) => (e.id === item.id ? trialItem(item, fromM, v) : e));
    const r = simulate({ ...model, expenses }, num(rate));
    const okCash = r.minCash >= floor;
    const okEnd = !useEndTarget || r.endTotal >= target;
    return { ok: okCash && okEnd, r, okCash, okEnd };
  };

  const current = valueAt(item, Math.max(startAbs, fromAbs), startAbs);
  const zero = test(0);
  if (!zero.ok) {
    return { infeasible: true, reason: !zero.okCash ? "cash" : "target", floor, target, fromM, name: item.name };
  }

  let lo = 0, hi = 40000;
  const top = test(hi);
  if (top.ok) {
    return {
      value: hi, capped: true, fromM, floor, target, binding: "none in range",
      current, minCash: top.r.minCash, endTotal: top.r.endTotal, name: item.name,
    };
  }
  for (let i = 0; i < 42; i++) {
    const mid = (lo + hi) / 2;
    if (test(mid).ok) lo = mid; else hi = mid;
  }
  const final = test(lo);
  const probe = test(lo + 25);
  const binding = !probe.okCash ? "cash floor" : !probe.okEnd ? "savings target" : "cash floor";
  return {
    value: lo, fromM, floor, target, binding,
    current, minCash: final.r.minCash, endTotal: final.r.endTotal, name: item.name,
  };
}
