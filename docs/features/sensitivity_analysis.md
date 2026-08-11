# Feature: Sensitivity analysis

## Scope

The Sensitivity tab: sweep the amount of one or two chosen items (any
income, expense, or one-time line) across a range and chart, per grid
point, the solver's max affordable amount and the ending net worth of
the plan *at that solved max* — "if I take the most this scenario
allows, where do I land". Pure grid logic in `src/sensitivity.js`
(`axisValues`, `setItemAmount`, `runSensitivity`); controls and the two
Recharts line charts live in `BudgetPlanner` (src/App.jsx).

## Non-scope

- Varying anything other than an item's base amount (dates, rates, caps).
- Auto-recompute — the grid is ~46 simulations per point, so it runs only
  on "Run analysis" and results are a snapshot of that click.

## Data / control flow

1. `model.sensitivity = { a, b }` — each axis `{ kind: "income" |
   "expense" | "onetime", itemId, min, max, steps }`; `b` optional.
   Picking an item defaults the range to 0…2× its current amount.
2. `runSensitivity(model, { a, b, solve })` sweeps the grid
   (`b` outer × `a` inner). Each cell replaces the items' **base
   amounts** via `setItemAmount` (scheduled changes still fold on top),
   then runs `solveMax` with the solver panel's settings at the headline
   rate. Both outputs read that one solve: `maxRent` is the solved value
   and `end` is its `endTotal` — the net worth you finish with if you
   actually pay the max. Both are NaN where even $0 is infeasible.
3. The tab feeds the sweep the **effective** model, so applied what-if
   overlays are included.
4. Two single-axis charts (never dual-axis): max rent vs A, and end net
   worth vs A. With a second item, one line per B value colored on a
   sequential teal ramp (light → dark as B grows — B is ordered, so a
   ramp, not categorical hues) with a legend; single-variable charts use
   the app's fixed teal/blue. A dashed reference line marks item A's
   current amount. Infeasible cells render as gaps.

## Related files

| File | Role |
|---|---|
| `src/sensitivity.js` | Pure `axisValues` linspace, `setItemAmount`, `runSensitivity` grid |
| `src/sensitivity.test.js` | Analytic grid expectations (flat-tax model), immutability, NaN cells |
| `src/App.jsx` | Sensitivity tab: axis pickers, run button, charts |
| `src/App.whatif.test.jsx` | jsdom smoke test: pick an item, run, both chart sections render |

## Invariants and constraints

- The sweep must not mutate the input model (`setItemAmount` copies).
- `steps` clamps to 2–25; the UI further caps B at 5 lines to match the
  validated 5-step ramp (never generate extra hues).
- A pct-linked one-time ignores its `amount`, so sweeping one is a
  no-op — the UI doesn't prevent it, the charts will just be flat.
- Results are stale after any model edit; the note tells the user to
  rerun. Nothing is persisted except the axis config (`model.sensitivity`).
