# Feature: Simulation engine

## Scope

`simulate(model, annualReturnPct)` in src/engine.js: the month-stepped
projection every chart, stat, CLI, and solver probe runs on. Pure — no
React, no I/O; the solver calls it ~45 times per run.

## Non-scope

Item resolution details (line_items), tax math (tax_model), 401(k) rules
(retirement_401k), account plumbing (accounts_flows) — each documented in
its own feature doc. This one covers the skeleton and ordering.

## Structure: two passes over the horizon

1. **Pre-pass — income & payroll** (independent of account balances):
   per month, resolve gross income, the 401(k) contribution (with the
   YTD counter: starts at `settings.ytd401k` in the first calendar year,
   resets each January), and the employer match. Then the **tax pass**
   prices each calendar year on its actual totals and spreads it across
   the year's months by income share (flat mode: per-month percentage) —
   see tax_model.
2. **Main pass — cash flows & balances**: per month, in order:
   net (gross − 401(k) − tax) → expenses → one-time in/outflows →
   deliberate transfers → surplus into the primary account → 401(k)+match
   into the first retirement account → overflow sweep → backstop/refill →
   monthly growth at `rate/12` → row snapshot (cash/invest/retire totals,
   minCash tracking, firstNegative).

Returns `{ rows, minCash, minCashAbs, firstNegative, endTotal }`.

## Related files

| File | Role |
|---|---|
| `src/engine.js` | `simulate` plus everything it composes |
| `src/engine.test.js` | All engine suites (`npm test`) |
| `scripts/compare/core.js` | CLI consumer diffing two models' simulations |
| `src/solver.js` | Hot-loop consumer; relies on purity |

## Invariants and constraints

- Horizon clamps to 1–600 months; missing/invalid start month falls back
  to January of the current year.
- Months are absolute indices (`year*12 + month0`) throughout.
- Tax must not depend on balances (the pre-pass assumes it), and nothing
  in the main pass may feed back into income/401(k)/tax.
- Row fields are consumed by name across App.jsx and scripts/ — treat the
  row shape as a public interface.
