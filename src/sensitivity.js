/* Sensitivity analysis: sweep one or two model items' amounts across a
   range and, for every grid point, report the solver's max affordable
   amount and the end net worth of the plan *at that max* — "if I take
   the most this scenario allows, where do I land". Pure — the
   Sensitivity tab in src/App.jsx renders the charts. */

import { num } from "./engine.js";
import { solveMax } from "./solver.js";

/* axis: { kind: "income" | "expense" | "onetime", itemId, min, max, steps } */
export function axisValues(axis) {
  const min = num(axis.min), max = num(axis.max);
  const n = Math.max(2, Math.min(25, Math.round(num(axis.steps)) || 2));
  if (!(max > min)) return [min];
  return Array.from({ length: n }, (_, i) => min + ((max - min) * i) / (n - 1));
}

const KEYS = { income: "incomes", expense: "expenses", onetime: "oneTimes" };

/* Replaces the item's base amount (scheduled changes still fold on top —
   the sweep asks "what if this line's amount were X"). A pct-linked
   one-time ignores its amount, so sweeping one is a visible no-op. */
export function setItemAmount(model, axis, value) {
  const key = KEYS[axis.kind];
  if (!key || !axis.itemId) return model;
  return { ...model, [key]: model[key].map((x) => (x.id === axis.itemId ? { ...x, amount: value } : x)) };
}

/* Grid run, b outer × a inner; cells[j * aValues.length + i] pairs with
   (aValues[i], bValues[j]). Both outputs come from the same solve — `end`
   is the ending net worth with the item at its solved maximum — and both
   are NaN where even $0 fails the solver's constraints. */
export function runSensitivity(model, { a, b = null, solve }) {
  const aValues = axisValues(a);
  const bValues = b ? axisValues(b) : [null];
  const cells = [];
  for (const bv of bValues) {
    const mB = b ? setItemAmount(model, b, bv) : model;
    for (const av of aValues) {
      const m = setItemAmount(mB, a, av);
      const s = solveMax(m, solve);
      const ok = s && !s.infeasible;
      cells.push({ a: av, b: bv, maxRent: ok ? s.value : NaN, end: ok ? s.endTotal : NaN });
    }
  }
  return { aValues, bValues, cells };
}
