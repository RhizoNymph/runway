# Feature: Sensitivity analysis

## Scope

The Sensitivity tab: sweep the amount of one or two chosen items (any
income, expense, or one-time line) across a range and chart two
**configurable output metrics** per grid point. Solver metrics — max
affordable amount, end net worth at that max — answer "what could I
commit to"; simulation metrics — end net worth as swept, lowest cash,
pre-overflow trough — answer "what does the plan as swept do" (the right
pick when the swept item *is* the rent). Pure grid logic in
`src/sensitivity.js` (`METRICS`, `axisValues`, `setItemAmount`,
`runSensitivity`); controls and the two Recharts line charts live in
`BudgetPlanner` (src/App.jsx).

## Non-scope

- Varying anything other than an item's base amount (dates, rates, caps).
- Auto-recompute — the grid is ~46 simulations per point, so it runs only
  on "Run analysis" and results are a snapshot of that click.

## Data / control flow

1. `model.sensitivity = { a, b, outputs }` — each axis `{ kind: "income"
   | "expense" | "onetime", itemId, min, max, steps }`; `b` optional;
   `outputs` two `METRICS` keys (default `["maxRent", "endAtMax"]`).
   Picking an item defaults the range to 0…2× its current amount.
2. `runSensitivity(model, { a, b, solve, rate, metrics })` sweeps the
   grid (`b` outer × `a` inner). Each cell pins the swept value via
   `setItemAmount` — a "set" change at the sim's start month that replaces
   any change dated exactly there (a solver write-back would otherwise
   mask the sweep), with the item's later schedule still folding on top;
   one-times get their amount replaced directly — then computes only what
   the chosen metrics need: `needs: "solve"`
   metrics run `solveMax` with the solver panel's settings (`maxRent`,
   `endAtMax` — NaN where even $0 is infeasible); `needs: "sim"` metrics
   share one `variantMetrics` simulation of the swept plan (`endPlan`,
   `minCash`, `trough`). All at the headline rate.
3. The tab feeds the sweep the **effective** model, so applied what-if
   overlays are included.
4. Two single-axis charts (never dual-axis), one per chosen output. With
   a second item, one line per B value colored on a sequential teal ramp
   (light → dark as B grows — B is ordered, so a ramp, not categorical
   hues) with a legend; single-variable charts use the app's fixed
   teal/blue by slot. A dashed gray reference line marks item A's current
   amount; cash metrics also draw the solver's floor as a dashed red
   line. Infeasible cells render as gaps.

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
