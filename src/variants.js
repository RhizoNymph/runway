/* What-if variants: named sets of expense tweaks laid over the live model,
   so trim scenarios compare against the current baseline instead of going
   stale in exported files. Pure — the What-if tab in src/App.jsx renders
   the comparison. */

import { simulate, ymToAbs, absToYm, num } from "./engine.js";

/* A tweak targets one expense line: from `startMonth` (empty/invalid = the
   sim's start month) it either sets the amount or shifts it by a delta.
   Each lands as an injected scheduled change appended after the item's own
   changes, so a same-month "set" tweak wins and a delta stacks — the same
   composition rules `valueAt` applies to everything else. */
export function applyVariant(model, variant) {
  const tweaks = (variant?.tweaks || []).filter((t) => t.itemId);
  if (!tweaks.length) return model;
  const startAbs = ymToAbs(model.settings.startMonth) ?? new Date().getFullYear() * 12;
  const startM = absToYm(startAbs);
  return {
    ...model,
    expenses: model.expenses.map((e) => {
      const mine = tweaks.filter((t) => t.itemId === e.id);
      if (!mine.length) return e;
      const injected = mine.map((t, i) => ({
        id: `tweak-${variant.id || "v"}-${t.id || i}`,
        month: ymToAbs(t.startMonth) !== null ? t.startMonth : startM,
        amount: num(t.amount),
        mode: t.mode === "delta" ? "delta" : "set",
      }));
      return { ...e, changes: [...(e.changes || []), ...injected] };
    }),
  };
}

/* Comparison metrics for one model at one return rate. `trough` is the
   lowest cash strictly before the earliest `overflowStart` month — the
   drawdown bottom that later cap-skimming would otherwise hide — falling
   back to the overall minimum when no link has a start month (or nothing
   precedes it). */
export function variantMetrics(model, rate) {
  const r = simulate(model, num(rate));
  const starts = model.accounts
    .map((a) => ymToAbs(a.overflowStart))
    .filter((v) => v !== null);
  const cut = starts.length ? Math.min(...starts) : null;
  const window = cut === null ? [] : r.rows.filter((x) => x.abs < cut);
  let trough = { cash: r.minCash, abs: r.minCashAbs };
  if (window.length) {
    trough = { cash: Infinity, abs: window[0].abs };
    for (const x of window) if (x.cash < trough.cash) trough = { cash: x.cash, abs: x.abs };
  }
  return {
    firstExp: r.rows[0]?.exp ?? 0,
    minCash: r.minCash,
    minCashAbs: r.minCashAbs,
    trough: trough.cash,
    troughAbs: trough.abs,
    endTotal: r.endTotal,
  };
}
