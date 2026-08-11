# Feature: Tax model

## Scope

How `simulate` turns gross income into tax per month: the flat override,
and the progressive 2025 federal + state model assessed per **calendar
year**. Functions `progressive`, `annualTax`, and the year-bucketing tax
pass inside `simulate` (src/engine.js).

## Non-scope

- Income resolution (line_items) and 401(k) amounts (retirement_401k) —
  they arrive here as inputs.
- Capital-gains, RSU, deduction itemization, credits — out of model.

## How a month's tax is computed

- `settings.useFlatTax` → `gross × flatTaxRate%`, per month, done.
- Otherwise `simulate` runs a **pre-pass** (income/401(k) are independent
  of balances) and buckets the months by calendar year:
  1. Full simulated year → taxed on its **actual totals**: gross =
     Σ gross, pre-tax = Σ c401.
  2. Partial year (the first and/or last of the horizon) → annualized by
     scaling both sums ×12/n — i.e. the unsimulated months are assumed to
     look like the simulated average.
  3. First calendar year adds `settings.ytd401k` to the deduction once
     (money contributed before the sim start, unscaled); the combined
     pre-tax is clamped to `limit401k` when a limit is set.
  4. `annualTax(estGross, estPre, settings)` prices the year: federal
     brackets + std deduction, CA brackets + std deduction + 1.2% SDI (or
     flat custom state rate), SS to the wage cap, Medicare + additional.
  5. Each month withholds its **proportional share**: `yearTax ×
     gross/estGross` — so the year's rows sum exactly to the year's bill
     (scaled by the simulated share for partial years), and a spike month
     carries proportionally more of it.

## Related files

| File | Role |
|---|---|
| `src/engine.js` | `FED`/`CAT` tables, `progressive`, `annualTax`, the per-year tax pass in `simulate` |
| `src/engine.test.js` | "simulate — calendar-year tax" suite: steady year, mid-year raise, partial first year + prior YTD, separate years |

## Invariants and constraints

- Bracket tables are approximate 2025 figures (single/married); the flat
  override exists precisely so a user can sidestep them.
- Monthly tax now depends on the **whole year's** income, not just its own
  month — a December raise retroactively shifts January's displayed tax
  (the year's bill is spread by income share). Cash-flow accuracy per year
  is exact; per month it is withholding-style smoothing.
- Partial-year annualization assumes unsimulated months resemble simulated
  ones. For a first year where real pre-start income differed a lot, the
  flat override is the honest tool.
- `ytd401k` participates in the first year's deduction as well as the
  contribution limit (retirement_401k) — do not double-count it elsewhere.
