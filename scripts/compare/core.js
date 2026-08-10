/* Pure comparison logic: run two budget models through the simulation
   engine and report deltas at checkpoint months plus plan-level events.
   No I/O here — the CLI wrapper (scripts/compare.js) handles files. */

import { simulate, ymToAbs, absToYm, absLabel, num } from "../../src/engine.js";

const LIST_SECTIONS = ["incomes", "expenses", "oneTimes", "accounts", "scenarios"];

export function startAbsOf(model) {
  return ymToAbs(model.settings.startMonth) ?? new Date().getFullYear() * 12;
}
export function horizonOf(model) {
  return Math.max(1, Math.min(600, Math.round(num(model.settings.horizonMonths))));
}
export function endAbsOf(model) {
  return startAbsOf(model) + horizonOf(model) - 1;
}

/* Same rule as the app: the second scenario drives headline numbers. */
export function baseScenario(model) {
  const s = model.scenarios || [];
  return s[Math.min(1, s.length - 1)] || { name: "Base", rate: 7 };
}

/* Checkpoint months as absolute month indices.
   spec: comma list of "YYYY-MM", 1-based month offsets, or "end".
   Default (no spec): settings.milestones, three evenly spaced points
   between the last milestone and the end, and the end itself; with no
   milestones, the horizon's quartiles. Always sorted, unique, in range. */
export function parseCheckpoints(spec, model) {
  const start = startAbsOf(model);
  const end = endAbsOf(model);
  let points = [];

  if (spec && String(spec).trim()) {
    for (const tokRaw of String(spec).split(",")) {
      const tok = tokRaw.trim();
      if (!tok) continue;
      if (tok === "end") { points.push(end); continue; }
      const ym = ymToAbs(tok);
      if (ym !== null) { points.push(ym); continue; }
      const n = Number(tok);
      if (Number.isFinite(n)) points.push(start + Math.max(1, Math.round(n)) - 1);
    }
  } else {
    const miles = (model.settings.milestones || [])
      .map(ymToAbs)
      .filter((a) => a !== null && a >= start && a <= end)
      .sort((a, b) => a - b);
    if (miles.length) {
      points.push(...miles);
      const last = miles[miles.length - 1];
      for (let i = 1; i <= 3; i++) points.push(last + Math.round((i * (end - last)) / 4));
      points.push(end);
    } else {
      const n = horizonOf(model);
      for (let i = 1; i <= 4; i++) points.push(start + Math.round((i * n) / 4) - 1);
    }
  }

  return [...new Set(points.filter((a) => a >= start && a <= end))].sort((a, b) => a - b);
}

/* Field-level diff of two models, so a report always states exactly what
   the variant changed. List sections are matched by item id. */
export function modelDiff(a, b) {
  const out = { settings: [], solver: [], items: [] };

  for (const [key, section] of [["settings", "settings"], ["solver", "solver"]]) {
    const av = a[key] || {}, bv = b[key] || {};
    for (const k of new Set([...Object.keys(av), ...Object.keys(bv)])) {
      if (JSON.stringify(av[k]) !== JSON.stringify(bv[k])) {
        out[section].push({ key: k, from: av[k], to: bv[k] });
      }
    }
  }

  for (const section of LIST_SECTIONS) {
    const av = a[section] || [], bv = b[section] || [];
    const aById = new Map(av.map((x) => [x.id, x]));
    const bById = new Map(bv.map((x) => [x.id, x]));
    for (const [id, ax] of aById) {
      const bx = bById.get(id);
      if (!bx) { out.items.push({ section, id, name: ax.name || id, kind: "removed" }); continue; }
      const fields = [];
      for (const k of new Set([...Object.keys(ax), ...Object.keys(bx)])) {
        if (k === "id") continue;
        if (JSON.stringify(ax[k]) !== JSON.stringify(bx[k])) fields.push({ field: k, from: ax[k], to: bx[k] });
      }
      if (fields.length) out.items.push({ section, id, name: bx.name || ax.name || id, kind: "changed", fields });
    }
    for (const [id, bx] of bById) {
      if (!aById.has(id)) out.items.push({ section, id, name: bx.name || id, kind: "added" });
    }
  }

  return out;
}

const pick = (row) => row
  ? { cash: row.cash, invest: row.invest, retire: row.retire, total: row.total }
  : null;
const deltaOf = (a, b) => a && b
  ? { cash: b.cash - a.cash, invest: b.invest - a.invest, retire: b.retire - a.retire, total: b.total - a.total }
  : null;

/* The full comparison: diff, per-checkpoint balances and deltas, events. */
export function compareModels(baseline, variant, { at } = {}) {
  const scenA = baseScenario(baseline);
  const scenB = baseScenario(variant);
  const simA = simulate(baseline, num(scenA.rate));
  const simB = simulate(variant, num(scenB.rate));
  const startA = startAbsOf(baseline);
  const startB = startAbsOf(variant);

  const warnings = [];
  if (baseline.settings.startMonth !== variant.settings.startMonth)
    warnings.push(`start month differs (${baseline.settings.startMonth} vs ${variant.settings.startMonth}); checkpoints align by calendar month`);
  if (horizonOf(baseline) !== horizonOf(variant))
    warnings.push(`horizon differs (${horizonOf(baseline)} vs ${horizonOf(variant)} months)`);
  if (num(scenA.rate) !== num(scenB.rate))
    warnings.push(`base scenario rate differs (${scenA.rate}% vs ${scenB.rate}%)`);

  const checkpoints = parseCheckpoints(at, baseline).map((abs) => {
    const a = pick(simA.rows[abs - startA]);
    const b = pick(simB.rows[abs - startB]);
    return { abs, ym: absToYm(abs), label: absLabel(abs), baseline: a, variant: b, delta: deltaOf(a, b) };
  });

  const events = {
    minCash: {
      baseline: { amount: simA.minCash, ym: absToYm(simA.minCashAbs), label: absLabel(simA.minCashAbs) },
      variant: { amount: simB.minCash, ym: absToYm(simB.minCashAbs), label: absLabel(simB.minCashAbs) },
      delta: simB.minCash - simA.minCash,
    },
    firstNegative: {
      baseline: simA.firstNegative === null ? null : { ym: absToYm(simA.firstNegative), label: absLabel(simA.firstNegative) },
      variant: simB.firstNegative === null ? null : { ym: absToYm(simB.firstNegative), label: absLabel(simB.firstNegative) },
    },
    endTotal: { baseline: simA.endTotal, variant: simB.endTotal, delta: simB.endTotal - simA.endTotal },
  };

  return {
    scenario: { name: scenA.name, rate: num(scenA.rate) },
    warnings,
    diff: modelDiff(baseline, variant),
    checkpoints,
    events,
  };
}
