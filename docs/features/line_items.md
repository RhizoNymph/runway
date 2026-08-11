# Feature: Recurring line items (incomes and expenses)

## Scope

The shared shape and month-by-month resolution of income and expense lines:
amounts, monthly vs yearly cadence, start/end windows, scheduled changes,
annual growth, and the Skip toggle. Resolution is `valueAt(item, abs,
startAbs)` in src/engine.js; editing is `ItemRow`/`ItemList` in src/App.jsx
(Expenses and Income tabs).

## Non-scope

- One-off events (see one_time_items) and account flows (accounts_flows).
- How totals feed taxes/savings (simulation_engine, tax_model).

## Resolution order in `valueAt`

1. `disabled: true` → $0 (the "Skip" checkbox).
2. Outside `startMonth`/`endMonth` (inclusive; "" = unbounded) → $0.
3. `cadence: "yearly"` → $0 unless the month's calendar month equals
   `cadenceMonth` (1–12; anything else behaves as January). The amount is
   **per occurrence** — a $450/yr registration is $450 in that one month,
   not $37.50/mo.
4. Base `amount`, folded through every scheduled change whose month has
   arrived (`changes` sorted by month): `mode: "set"` (default, including
   missing) replaces the value, `mode: "delta"` adds its amount to the
   value in effect — negative allowed, consecutive deltas stack, a later
   set resets the base.
5. × `(1 + growth/100) ^ floor(elapsed months / 12)` — growth compounds on
   simulation-anniversary years, for yearly items too.

## UI

- Each row: Name · Amount · **Every (month/year)** · %/yr · "…" schedule
  panel · Skip · drag handle · remove.
- Switching a row to yearly defaults its charged month to the simulation
  start month; the "…" panel gains a "Charged every [Jan…Dec]" selector,
  and the panel-indicator button lights up for yearly rows.
- Below the list total, a note shows the yearly items' annual sum and the
  averaged monthly equivalent, since the "first month" total only includes
  yearly items charged in that month.
- "Sort by amount" reorders the stored list (it composes with drag-reorder)
  by monthly-equivalent amount — yearly items ÷ 12, skipped items last —
  toggling descending/ascending per click. The One-time tab has its own
  sort using each item's resolved dollar value in its month.

## Invariants and constraints

- Missing `cadence` means monthly — old saved models are unchanged.
- Yearly incomes work too (e.g. an annual bonus), but note the tax model
  annualizes each month's gross ×12, so a spike month is taxed at an
  inflated marginal rate — same approximation as any income spike here.
- A one-time item linked to a yearly expense (`basis: "pct"`) resolves
  against that expense's value in the one-time's month — $0 unless the
  months line up.
- The solver can target a yearly item; its trial writes scheduled changes,
  which compose with cadence as usual.
