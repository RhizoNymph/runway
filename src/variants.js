/* What-if variants: named sets of expense tweaks laid over the live model,
   so trim scenarios compare against the current baseline instead of going
   stale in exported files. Pure — the What-if tab in src/App.jsx renders
   the comparison. */

import { simulate, ymToAbs, absToYm, num } from "./engine.js";

/* A tweak targets one line item — `kind`: "expense" (default, so old saved
   variants are unchanged), "income", or "onetime". From `startMonth`
   (empty/invalid = the variant's own start month, else the sim's) it either
   sets the amount or shifts it by a delta. A variant-level `startMonth`
   slides the whole scenario at once: it is the default for tweaks without a
   month of their own, and a floor for the rest — a tweak dated earlier is
   pushed to it, a tweak dated later keeps its later date (a post-move
   constraint survives the slide). Income/expense tweaks land as injected
   scheduled changes appended after the item's own changes, so a same-month
   "set" tweak wins and a delta stacks — the same composition rules
   `valueAt` applies to everything else. One-time items have no schedule, so
   their tweaks replace or shift the amount directly and ignore months. */
const KIND_KEYS = { income: "incomes", expense: "expenses", onetime: "oneTimes" };
const tweakKind = (t) => (KIND_KEYS[t.kind] ? t.kind : "expense");

export function applyVariant(model, variant) {
  const tweaks = (variant?.tweaks || []).filter((t) => t.itemId);
  if (!tweaks.length) return model;
  const startAbs = ymToAbs(model.settings.startMonth) ?? new Date().getFullYear() * 12;
  const varStart = ymToAbs(variant.startMonth);
  const out = { ...model };
  for (const [kind, key] of Object.entries(KIND_KEYS)) {
    const mine = tweaks.filter((t) => tweakKind(t) === kind);
    if (!mine.length) continue;
    out[key] = out[key].map((item) => {
      const forItem = mine.filter((t) => t.itemId === item.id);
      if (!forItem.length) return item;
      if (kind === "onetime") {
        let amount = num(item.amount);
        for (const t of forItem) amount = t.mode === "delta" ? amount + num(t.amount) : num(t.amount);
        return { ...item, amount };
      }
      const injected = forItem.map((t, i) => {
        const own = ymToAbs(t.startMonth) ?? startAbs;
        const eff = varStart !== null ? Math.max(own, varStart) : own;
        return {
          id: `tweak-${variant.id || "v"}-${t.id || i}`,
          month: absToYm(eff),
          amount: num(t.amount),
          mode: t.mode === "delta" ? "delta" : "set",
        };
      });
      return { ...item, changes: [...(item.changes || []), ...injected] };
    });
  }
  return out;
}

/* The model as the app actually simulates it: every variant whose
   `applied` checkbox is on, overlaid in list order. Consumers that render
   or compare "the current plan" (charts, solver, compare CLI) go through
   this; editors keep working on the raw model. */
export function withApplied(model) {
  return (model.variants || []).filter((v) => v.applied).reduce((m, v) => applyVariant(m, v), model);
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
