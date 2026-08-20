# Runway — Codebase Overview

```yaml
Overview:
  description: >
    Monthly budget and savings scenario simulator (React + Recharts). Models
    income, expenses, one-time cash events, 401(k) contributions/match, taxes
    (2025 federal + CA), and multiple investment-return scenarios over a
    configurable horizon. Includes a bisection solver that finds the maximum
    affordable amount for an expense line (typically rent) subject to a cash
    floor and optional ending-net-worth target. All state autosaves to
    localStorage under key `budget-model-v1`; Export/Import JSON is the
    portable format.
  subsystems:
    - engine (src/engine.js): pure, React-free model — month helpers,
      tax model, `valueAt` line-item resolution, `contribution401k`, and the
      month-by-month `simulate`. Unit-tested in src/engine.test.js (vitest).
    - persistence: `data/model.json` on disk via GET/PUT /api/model (Vite
      middleware in vite.config.js), agent-editable, with the app adopting
      external edits by polling; localStorage fallback for static builds;
      debounced autosave and JSON import/export in the main component.
      Schema documented in docs/features/persistence.md.
    - solver: pure `solveMax`/`trialItem` in src/solver.js — bisection (42
      iters, $0–$40k) over a trial "set" change at the from-month, keeping
      the item's other scheduled changes and window in force, rerunning
      `simulate` per probe. Unit-tested in src/solver.test.js; the panel
      and "Use this amount" live in src/App.jsx.
    - ui (src/App.jsx): single component `BudgetPlanner` — readout strip
      and allocation bar pinned to a selectable month
      (`settings.readoutMonth`, empty = first month) with three mini bar
      charts (take-home / living costs / leftover per month, click a bar
      to pin the readout), two Recharts charts, solver panel, tabs of
      editors,
      and a sticky plan-in-effect sidebar (`.bp-side`, wide viewports)
      listing applied what-ifs (uncheck to remove) and skipped lines (tick
      to include) so ambient state is always visible. Every list row (expenses, incomes, one-times, accounts,
      scenarios) is drag-to-reorder via a ⋮⋮ handle (`useDragReorder`,
      native HTML5 drag events — no library; no touch support). Month
      fields are a custom `MonthInput` popover picker (year stepper +
      month grid; typed YYYY-MM still accepted; empty = unbounded) because
      native type="month" has no picker in Firefox/Safari.
      Styling is an inline CSS string (`CSS` const), `.bp-*` classes,
      light-only palette.
  data_flow: >
    User edits → `setModel` (immutably via patch helpers) → `useMemo` reruns
    `simulate` once per scenario → derived chart data / year rollups / stat
    readouts render. Model ↔ localStorage via debounced effect (900ms) on
    every model change; import/export bypasses via file JSON. Solver clones
    the model with a trial "set" change on the chosen expense (the rest of
    the item's schedule stays live) and calls `simulate` directly; "Use
    this amount" writes that exact trial item back, rounded down to $25.

Features Index:
  simulation_engine:
    description: Month-stepped projection of balances, taxes, 401(k), flows
    entry_points: [src/engine.js:simulate, src/engine.js:valueAt]
    depends_on: [tax_model, retirement_401k, line_items]
    doc: docs/features/simulation_engine.md  # create when touched
  line_items:
    description: Recurring income/expense lines — monthly or once-per-year cadence, windows, scheduled changes, growth, Skip
    entry_points: [src/engine.js:valueAt, "src/App.jsx:ItemRow / ItemList"]
    depends_on: []
    doc: docs/features/line_items.md
  tax_model:
    description: 2025 federal + CA progressive tax assessed per calendar year (partial years annualized), FICA, flat override
    entry_points: [src/engine.js:annualTax, src/engine.js:progressive, "src/engine.js:simulate (tax pass)"]
    depends_on: []
    doc: docs/features/tax_model.md
  retirement_401k:
    description: 401(k) contribution modes (% of gross, or max-the-limit even split with mid-year starts and prior-YTD) and employer match
    entry_points: [src/engine.js:contribution401k, "src/App.jsx (Accounts & 401(k) tab)"]
    depends_on: []
    doc: docs/features/retirement_401k.md
  accounts_flows:
    description: Transfers, leftover-primary routing, and balance-cap overflow waterfall between accounts
    entry_points: ["src/engine.js:simulate (flows + overflow)", "src/App.jsx (Accounts & 401(k) tab)"]
    depends_on: [simulation_engine]
    doc: docs/features/accounts_flows.md
  one_time_items:
    description: One-off cash events, fixed $ or a % of an expense line (deposit = 200% of rent)
    entry_points: [src/engine.js:oneTimeAmount, "src/App.jsx (One-time tab)"]
    depends_on: [simulation_engine]
    doc: docs/features/one_time_items.md
  rent_solver:
    description: Bisection search for max affordable expense under constraints, honoring the item's schedule
    entry_points: [src/solver.js:solveMax, src/solver.js:trialItem, "src/App.jsx (solver panel)"]
    depends_on: [simulation_engine]
    doc: docs/features/rent_solver.md
  persistence:
    description: data/model.json via dev-server API (agent-editable, live-reloading) with localStorage fallback; JSON export/import
    entry_points: [src/App.jsx:store, "vite.config.js:modelStore", src/App.jsx:exportJson, src/App.jsx:importJson]
    depends_on: []
    doc: docs/features/persistence.md
  ui:
    description: Single-component React UI, inline CSS, Recharts charts, tabs
    entry_points: [src/App.jsx:BudgetPlanner, src/main.jsx]
    depends_on: [simulation_engine, rent_solver, persistence]
    doc: docs/features/ui.md  # create when touched
  what_if_variants:
    description: Named expense-tweak scenarios stored in the model, compared side by side against the live baseline (What-if tab); an "applied" checkbox overlays a scenario on the plan reversibly (all surfaces go through withApplied), and bake-into-plan makes it permanent
    entry_points: [src/variants.js:applyVariant, src/variants.js:withApplied, src/variants.js:variantMetrics, "src/App.jsx (What-if tab)"]
    depends_on: [simulation_engine, line_items, rent_solver]
    doc: docs/features/what_if_variants.md
  sensitivity_analysis:
    description: Sweep one or two items' amounts over ranges and chart two configurable outputs per grid point — solver metrics (max rent, end NW at that max) or swept-plan metrics (end NW, lowest cash, pre-overflow trough) (Sensitivity tab)
    entry_points: [src/sensitivity.js:runSensitivity, "src/App.jsx (Sensitivity tab)"]
    depends_on: [simulation_engine, rent_solver, what_if_variants]
    doc: docs/features/sensitivity_analysis.md
  compare_cli:
    description: CLI diffing a variant model against data/model.json — impact at milestone/checkpoint months, lowest cash, end net worth
    entry_points: [scripts/compare.js, scripts/compare/core.js]
    depends_on: [simulation_engine, persistence]
    doc: docs/features/compare_cli.md
```

## Key files

| File | Role |
|---|---|
| `src/engine.js` | Pure model: helpers, tax math, `valueAt`, `contribution401k`, `simulate` |
| `src/engine.test.js` | Vitest unit tests for the engine (`npm test`) |
| `src/solver.js` | Pure affordability solver: `trialItem`, `solveMax` |
| `src/solver.test.js` | Vitest unit tests for the solver |
| `src/variants.js` | Pure what-if overlays: `applyVariant`, `variantMetrics` |
| `src/variants.test.js` | Vitest unit tests for the what-if overlays |
| `src/sensitivity.js` | Pure sensitivity sweeps: `runSensitivity` over item-amount grids |
| `src/sensitivity.test.js` | Vitest unit tests for the sweeps |
| `src/App.jsx` | UI + defaults + solver + persistence (`BudgetPlanner`) |
| `src/main.jsx` | React 18 mount |
| `index.html` | Vite entry |
| `vite.config.js` | Port 5180, relative base for static hosting |

## Invariants and constraints

- `simulate` is pure: no React, no I/O — safe to call in loops (the solver
  calls it ~45 times per run).
- Months are represented as absolute month indices (`year*12 + month0`);
  `ymToAbs`/`absToYm` convert to/from `YYYY-MM` strings. Empty/invalid month
  strings mean "unbounded".
- Horizon is clamped to 1–600 months. Balances compound at `rate/12` monthly.
- Scenario list order matters: the **second** scenario drives headline stats
  and the solver (`scenarios[min(1, len-1)]`).
- The `primary` account receives monthly surplus (and drains on shortfall);
  the first `retirement` account receives 401(k) + match. If no accounts
  exist, a fallback cash account is used.
- Accounts may set `capAmount` + `overflowTo`: after flows land each month,
  balance above the cap moves to the destination (whole balance, chains
  cascade, cycles are cut off). The same link is a backstop: a negative
  balance pulls back along the chain just enough to reach $0 — or, with
  `refillToCap: true` on the account, all the way back up to the cap
  ("self-healing"; missing/false = old behavior). 0/missing cap or invalid
  destination = link off, both directions; an `overflowStart` month keeps
  the link dormant (both directions) until it arrives. See
  docs/features/accounts_flows.md.
- 401(k): `settings.mode401k` is `"pct"` (contribute `pct401k`% of gross) or
  `"maxEven"` (contribute `(limit − YTD) / months left in the calendar year`,
  so mid-year starts and lean months still max the limit by December). Both
  clamp to gross and to the remaining annual limit. The YTD counter starts at
  `settings.ytd401k` in the first calendar year and resets to 0 each later
  January. Missing `mode401k` must behave as `"pct"`, missing `ytd401k` as 0
  (old saved models predate the fields).
- Line items may set `cadence: "yearly"` + `cadenceMonth` (1–12): the amount
  is charged once a year in that calendar month (per-occurrence dollars, not
  averaged). Missing/other cadence = monthly; invalid cadenceMonth = January.
  See docs/features/line_items.md.
- Income items may set `afterTax: true` ("post-tax" checkbox): the amount
  skips gross, tax, FICA, and the 401(k)/match base and lands straight in
  net — for money taxed on someone else's return (an unmarried partner's
  take-home). Rows expose it as `postTax`; missing = taxable as before.
- Growth compounds on anniversaries of the month the value in effect was
  last established — the base amount from the sim start, a scheduled
  change's value from its own change month (deltas apply to the grown value
  and restart the clock). What a change types is what its month bills.
- Progressive tax is assessed per calendar year on the year's actual
  simulated totals (partial first/last years annualized ×12/n; the first
  year's deduction includes `ytd401k`), each month withholding its
  gross-proportional share. Flat tax stays per-month. See
  docs/features/tax_model.md.
- Solver trials replace only a change dated exactly at the from-month; all
  other scheduled changes and the item's window stay in force. "Use this
  amount" writes the solved value (rounded down to $25) into the **base
  amount** when solving from the sim start — never a start-dated change,
  which would shadow the Amount field — and as a scheduled change only for
  a future from-month. See docs/features/rent_solver.md.
- Any line item or one-time with `disabled: true` is excluded from the
  simulation (`valueAt`/`oneTimeAmount` return 0) without losing its data;
  a linked one-time follows a disabled expense to $0. Missing `disabled`
  means active. The UI exposes this as the "Skip" checkbox per row.
- One-time items: `basis === "pct"` links the amount to an expense line
  (`pct`% of `valueAt` that expense in the item's month; missing link → $0).
  Any other/missing `basis` means fixed `amount`. Linked items resolve
  against the expenses array `simulate` receives, which is what lets the
  rent solver's trial rents scale a rent-linked deposit.
- Saved model shape is merged over `makeDefaults()` on load — but the merge
  is shallow, so `settings` from an old save replaces the defaults object
  wholesale. New settings fields must tolerate being `undefined`.
- Tests cover the engine and the solver (src/*.test.js) plus the CLI
  script modules. No linter, no TypeScript. Plain JSX,
  React 18. Run with `npm test` (vitest, pinned exact).
```
