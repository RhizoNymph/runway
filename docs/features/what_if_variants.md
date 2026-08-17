# Feature: What-if variants (trim scenarios)

## Scope

Named what-if scenarios — sets of expense tweaks — stored in the model and
compared side by side against the live baseline on the **What-if** tab.
Pure overlay/metrics logic in `src/variants.js` (`applyVariant`,
`variantMetrics`); the tab UI, the optional max-rent column, and "Apply to
plan" live in `BudgetPlanner` (src/App.jsx).

## Non-scope

- Return-rate scenarios (the `scenarios` array) — those vary markets, not
  spending.
- The offline `scripts/trim-report.js` / `data/variants/*.json` flow — that
  predates this feature and snapshots models to files; this tab is the
  live-model replacement for day-to-day comparison.

## Data / control flow

1. `model.variants[]` — each `{ id, name, startMonth, tweaks: [{ id,
   kind, itemId, mode, amount, startMonth }] }`. A tweak targets one line
   item — `kind` is `"expense"` (default when missing, so old saves are
   unchanged), `"income"`, or `"onetime"` — and from its `startMonth`
   (empty/invalid = the variant's, else the sim's start month) it either
   sets the amount (`mode: "set"`, default) or shifts it (`mode:
   "delta"`). One-time items have no schedule: their tweaks replace or
   shift the amount directly and ignore months. The variant-level
   `startMonth` slides the whole scenario at once ("what if I did all
   this in three months?"): it defaults tweaks without their own month
   and floors the rest — a tweak dated earlier is pushed to it, one dated
   later keeps its later date, so post-move constraints survive the
   slide.
2. `applyVariant(model, variant)` returns a new model whose tweaked
   expenses carry injected scheduled changes, appended after the item's own
   changes — so a same-month set tweak wins, deltas stack, and a later
   scheduled "set" resets a delta tweak, exactly per `valueAt`'s rules.
3. When the tab is active, a `useMemo` builds one row per scenario plus the
   baseline: `variantMetrics(varied, headlineRate)` simulates and reports
   first-month spend, overall min cash, **trough** (lowest cash strictly
   before the earliest `overflowStart` — the drawdown bottom cap-skimming
   later hides; overall min if no link has a start month), and end net
   worth. Deltas are shown against the baseline row.
4. Optional max-rent column (checkbox): reruns `solveMax` per row with the
   solver panel's item/floor/month — off by default since it's ~45 sims per
   scenario per recompute.
5. **Applied** (per-scenario checkbox): the scenario overlays the live plan
   everywhere — `withApplied(model)` is what the charts, readouts, solver,
   and the compare/trim CLIs actually simulate — while the raw expense
   lines stay untouched; unchecking reverts. In the table, the baseline row
   includes every applied scenario; an applied scenario's own row shows the
   plan *without* it, so all deltas read as "what toggling this checkbox
   does". The tab label counts applied scenarios, and the plan-in-effect
   sidebar (every tab, wide viewports) lists them with uncheck-to-remove
   toggles alongside skipped income/expense lines.
6. **Bake into plan** permanently writes a scenario's injected changes into
   the real expense lines (via `applyVariant`) and removes the scenario
   from the list, preventing double-application.

## Related files

| File | Role |
|---|---|
| `src/variants.js` | Pure `applyVariant` + `variantMetrics` |
| `src/variants.test.js` | Overlay composition, mutation-safety, trough-vs-min separation |
| `src/App.jsx` | What-if tab: comparison table, scenario/tweak editors, apply |

## Invariants and constraints

- `variants` is part of the saved model (autosave/export/import carry it);
  missing key = no scenarios (old saves unchanged, `makeDefaults` seeds
  `[]`).
- Unapplied scenarios never affect the simulation, charts, or solver —
  they are read-only overlays computed on demand (tab active only). Applied
  ones flow through `withApplied` only; nothing else may mutate the lines.
- Every consumer of "the current plan" must go through `withApplied`
  (App `effective`, compare CLI, trim report) or applied scenarios would
  silently disagree between surfaces.
- Tweak injection must go through `applyVariant` so composition semantics
  stay identical between the table, "applied", and "Bake into plan".
- Tweaks reference expenses by `itemId`; deleting an expense silently
  orphans its tweaks (they no-op — `applyVariant` filters unknown ids).
