#!/usr/bin/env node
/* Compare a variant budget model against a baseline and report the impact.

   Usage:
     npm run compare -- <variant.json> [options]
     node scripts/compare.js data/variants/rent-3600.json

   Options:
     --baseline <path>   baseline model (default: data/model.json)
     --at <spec>         checkpoint months: comma list of YYYY-MM, 1-based
                         month offsets, or "end" (default: the model's
                         settings.milestones, evenly spaced fills to the
                         end, and the end; quartiles if no milestones)
     --json              machine-readable output

   Exit codes: 0 ok · 1 bad usage / unreadable model */

import fs from "node:fs";
import { compareModels } from "./compare/core.js";

function fail(msg) {
  console.error(`compare: ${msg}`);
  process.exit(1);
}

function loadModel(path) {
  let text;
  try { text = fs.readFileSync(path, "utf8"); } catch { fail(`cannot read ${path}`); }
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { fail(`${path} is not valid JSON (${e.message})`); }
  if (!parsed || typeof parsed !== "object" || !parsed.settings) fail(`${path} does not look like a model (no "settings")`);
  return parsed;
}

/* args */
const argv = process.argv.slice(2);
let variantPath = null, baselinePath = "data/model.json", at = null, json = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--baseline") baselinePath = argv[++i] ?? fail("--baseline needs a path");
  else if (a === "--at") at = argv[++i] ?? fail("--at needs a value");
  else if (a === "--json") json = true;
  else if (a === "--help" || a === "-h") { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace("#!/usr/bin/env node\n/* ", "")); process.exit(0); }
  else if (a.startsWith("--")) fail(`unknown option ${a}`);
  else if (!variantPath) variantPath = a;
  else fail(`unexpected argument ${a}`);
}
if (!variantPath) fail("usage: compare <variant.json> [--baseline <path>] [--at <months>] [--json]");

const baseline = loadModel(baselinePath);
const variant = loadModel(variantPath);
const result = compareModels(baseline, variant, { at });

if (json) {
  console.log(JSON.stringify({ baseline: baselinePath, variant: variantPath, ...result }, null, 2));
  process.exit(0);
}

/* human report */
const money = (n) => (n < 0 ? "−" : "") + "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
const signed = (n) => (n >= 0 ? "+" : "−") + "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
const fmtVal = (v) => typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);

console.log(`Compare  ${baselinePath}  →  ${variantPath}`);
console.log(`Scenario ${result.scenario.name} @ ${result.scenario.rate}%/yr`);
for (const w of result.warnings) console.log(`⚠ ${w}`);

const { diff } = result;
console.log("\nWhat changed:");
if (!diff.settings.length && !diff.solver.length && !diff.items.length) {
  console.log("  (nothing — the models are identical)");
}
for (const d of diff.settings) console.log(`  settings.${d.key}: ${fmtVal(d.from)} → ${fmtVal(d.to)}`);
for (const d of diff.solver) console.log(`  solver.${d.key}: ${fmtVal(d.from)} → ${fmtVal(d.to)}`);
for (const it of diff.items) {
  if (it.kind === "added") console.log(`  ${it.section}: + "${it.name}" added`);
  else if (it.kind === "removed") console.log(`  ${it.section}: − "${it.name}" removed`);
  else for (const f of it.fields) console.log(`  ${it.section} "${it.name}": ${f.field} ${fmtVal(f.from)} → ${fmtVal(f.to)}`);
}

const ev = result.events;
console.log("\nEvents:");
console.log(`  Lowest cash    ${money(ev.minCash.baseline.amount)} (${ev.minCash.baseline.label})  →  ${money(ev.minCash.variant.amount)} (${ev.minCash.variant.label})   ${signed(ev.minCash.delta)}`);
const negTxt = (x) => (x === null ? "never" : x.label);
console.log(`  Cash negative  ${negTxt(ev.firstNegative.baseline)}  →  ${negTxt(ev.firstNegative.variant)}`);
console.log(`  End net worth  ${money(ev.endTotal.baseline)}  →  ${money(ev.endTotal.variant)}   ${signed(ev.endTotal.delta)}`);

console.log("\nCheckpoints:");
const rows = result.checkpoints.map((c) => c.baseline && c.variant ? [
  c.label,
  `${money(c.baseline.cash)} → ${money(c.variant.cash)}`,
  signed(c.delta.cash),
  `${money(c.baseline.total)} → ${money(c.variant.total)}`,
  signed(c.delta.total),
] : [c.label, "(out of range)", "", "", ""]);
const header = ["", "cash", "Δ cash", "net worth", "Δ net worth"];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
console.log("  " + header.map((h, i) => h.padEnd(widths[i])).join("   "));
for (const r of rows) console.log("  " + r.map((c, i) => c.padEnd(widths[i])).join("   "));
