# Runway

A monthly budget and savings simulator. Model income, expenses, one-time costs,
401(k) contributions and investment accounts across return scenarios — and solve
for the highest rent that still keeps you above a cash floor.

## Running it

```
npm install
npm run dev
```
Opens on http://localhost:5180. `npm run build` emits a static `dist/` you can
host anywhere or open directly (the config uses relative asset paths).
`npm test` runs the engine's unit tests.

## Where your data lives

Running under `npm run dev` (or `npm run preview`), the model autosaves to
**`data/model.json`** — a pretty-printed, gitignored JSON file. Edit it with
any tool (or point an agent at it; the schema is documented in
`docs/features/persistence.md`) and the open app picks the change up within
a few seconds. The first run migrates whatever the browser had saved.

As a static build with no server, the app falls back to `localStorage`
under `budget-model-v1`, scoped to the origin you open it from. **Export**
writes the same JSON as a download; **Import** reads one back.

## Notes on the model

- One month per step. Balances compound monthly at `annual rate / 12`.
- Taxes use 2025 federal and California brackets, the standard deduction, Social
  Security, Medicare and CA SDI. 401(k) contributions reduce taxable income and
  stop for the year at the annual limit. Estimates only — no itemizing, credits,
  RSUs or bonus withholding. Check against a paystub and use the flat-rate
  override if it drifts.
- 401(k) contributions are either a percentage of gross or "max the limit,
  split evenly": what's left of the annual limit spread over the months
  remaining in the calendar year, so the limit is reached exactly in December
  even for mid-year starts. "Already contributed this year" counts prior
  contributions against the first year's limit. The employer match is based
  on the elected percentage (percent mode) or the percentage actually
  contributed (even-split mode), capped at the match limit.
- A one-time item can be a fixed dollar amount or a percentage of an expense
  line's rate in that month — e.g. "Deposit + first month" as 200% of rent.
  Linked items follow the rent solver's answer automatically.
- Scheduled changes adjust a line item from a month onward — "set to" replaces
  the amount, "± by" shifts it by a positive or negative difference. Annual
  growth compounds yearly on top of whatever amount is in effect.
- A line item can recur monthly or once per year ("Every: year"): the full
  amount is charged in its chosen calendar month — registration, annual
  premiums, memberships — instead of being averaged across months.
- The second scenario in the list drives the headline numbers and the solver.
- Leftover money each month lands in the account marked "leftover money lands
  here". If it goes negative, that account drains and the shortfall is flagged.

## Files

```
index.html          Vite entry
src/main.jsx        React mount
src/engine.js       the model: taxes, line items, month-by-month simulation
src/engine.test.js  unit tests for the engine
src/App.jsx         the UI, defaults, solver and persistence
```
