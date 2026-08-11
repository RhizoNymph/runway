# Feature: Rent (affordability) solver

## Scope

Finding the maximum amount for one expense line, from a chosen month
onward, that keeps every simulated month's cash at or above a floor — and
optionally the ending net worth at or above a target. Pure search logic in
`src/solver.js` (`solveMax`, `trialItem`); the panel that drives it and
"Use this amount" live in `BudgetPlanner` (src/App.jsx).

## Non-scope

- The simulation itself (simulation_engine); the solver only calls
  `simulate` as a black box.
- Multi-variable optimization — one expense line at a time.

## Data / control flow

1. The panel resolves the target item: `solver.itemId`, else the first
   expense matching /rent|mortgage|housing/i, else the first expense.
2. `solveMax(model, { itemId, fromMonth, cashFloor, endTarget,
   useEndTarget, rate })` builds a **trial item** per probe amount `v`
   (`trialItem`): `v` lands as a `mode: "set"` change at `fromMonth`, and
   **everything else the item schedules stays in force** — changes before
   `fromMonth`, delta changes after it (they stack on top of `v`), later
   "set" changes (they end `v`'s influence), and the item's
   `startMonth`/`endMonth` window. Only a change dated exactly `fromMonth`
   is replaced. The rest of the model is untouched; `simulate` runs at the
   given scenario `rate`.
3. Feasible(v) ⇔ `minCash ≥ cashFloor` and (if enabled)
   `endTotal ≥ endTarget`. $0 infeasible → `{ infeasible, reason }`;
   $40,000 feasible → capped result; otherwise 42 bisection steps over
   [0, 40000] converge on the boundary, and a `+$25` probe labels the
   binding constraint ("cash floor" / "savings target").
4. The result feeds the gauge + summary note. **Use this amount** writes
   `trialItem(item, fromM, floor25(value))` back into the model (the solve
   change gets a fresh uid) — the applied item is exactly the tested one,
   rounded down to $25, so the plan you keep matches the reported
   minCash/endTotal (rounding down errs feasible).

## Related files

| File | Role |
|---|---|
| `src/solver.js` | Pure `trialItem` + `solveMax` (bisection, feasibility, binding label) |
| `src/solver.test.js` | Trial composition; floor/target binding; deltas, later sets, and endMonth honored |
| `src/App.jsx` | Panel UI, item resolution, `runSolver`/`applySolved`, gauge |

## Invariants and constraints

- The solver uses the **second** scenario's rate (`scenarios[min(1, n−1)]`).
- Bisection assumes feasibility is monotone in `v` (more expense → less
  cash, everywhere) — true because expenses only subtract, and pct-linked
  one-times scale with the trial value in the same direction.
- The returned `value` is always a feasible probe (only feasible mids move
  `lo`); display and apply round **down** to $25.
- Months before `fromMonth` keep the item's own scheduled value — solving
  "from March" does not touch January/February.
- A solved item with future "set" changes reports affordability for the
  window up to the next set; the capped "$40k works" result is possible and
  truthful there.
- The solver's cash floor reads cash-type balances. A cap equal to the
  floor on the only cash account leaves zero buffer after skims — any
  negative-surplus month then breaches the floor (use `refillToCap`, a cap
  above the floor, or a later `overflowStart` if that's not intended).
