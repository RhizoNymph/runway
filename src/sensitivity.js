/* Sensitivity analysis: sweep one or two model items' amounts across a
   range and, for every grid point, report the chosen output metrics.
   Solver metrics answer "what's the most I could commit to, and where
   does paying it land me"; simulation metrics answer "what does the plan
   as swept do". Pure — the Sensitivity tab in src/App.jsx renders the
   charts. */

import { num } from "./engine.js";
import { solveMax } from "./solver.js";
import { variantMetrics } from "./variants.js";

/* What a chart can show. `needs` decides the per-cell work: "solve" runs
   the bisection solver (≈45 sims), "sim" one simulation shared by all sim
   metrics. */
export const METRICS = {
  maxRent: { label: "Max affordable (solver)", needs: "solve" },
  endAtMax: { label: "End net worth at that max", needs: "solve" },
  endPlan: { label: "End net worth, plan as swept", needs: "sim" },
  minCash: { label: "Lowest cash balance", needs: "sim" },
  trough: { label: "Lowest cash before overflow starts", needs: "sim" },
};

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
   (aValues[i], bValues[j]). Each cell carries every requested metric;
   solver metrics are NaN where even $0 fails the solver's constraints. */
export function runSensitivity(model, { a, b = null, solve, rate, metrics = ["maxRent", "endAtMax"] }) {
  const needSolve = metrics.some((k) => METRICS[k]?.needs === "solve");
  const needSim = metrics.some((k) => METRICS[k]?.needs === "sim");
  const aValues = axisValues(a);
  const bValues = b ? axisValues(b) : [null];
  const cells = [];
  for (const bv of bValues) {
    const mB = b ? setItemAmount(model, b, bv) : model;
    for (const av of aValues) {
      const m = setItemAmount(mB, a, av);
      const cell = { a: av, b: bv };
      if (needSolve) {
        const s = solveMax(m, solve);
        const ok = s && !s.infeasible;
        cell.maxRent = ok ? s.value : NaN;
        cell.endAtMax = ok ? s.endTotal : NaN;
      }
      if (needSim) {
        const v = variantMetrics(m, num(rate));
        cell.endPlan = v.endTotal;
        cell.minCash = v.minCash;
        cell.trough = v.trough;
      }
      cells.push(cell);
    }
  }
  return { aValues, bValues, cells };
}
