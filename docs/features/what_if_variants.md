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

1. `model.variants[]` — each `{ id, name, tweaks: [{ id, itemId, mode,
   amount, startMonth }] }`. A tweak targets one expense line: from
   `startMonth` (empty/invalid = the sim's start month) it either sets the
   amount (`mode: "set"`, default) or shifts it (`mode: "delta"`).
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
5. **Apply to plan** bakes a scenario's injected changes into the real
   expense lines (via `applyVariant`) and removes the scenario from the
   list, preventing double-application.

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
- Scenarios never affect the simulation, charts, or solver until applied —
  they are read-only overlays computed on demand (tab active only).
- Tweak injection must go through `applyVariant` so composition semantics
  stay identical between the table and "Apply to plan".
- Tweaks reference expenses by `itemId`; deleting an expense silently
  orphans its tweaks (they no-op — `applyVariant` filters unknown ids).
