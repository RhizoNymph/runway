# Feature: One-time items (fixed and expense-linked)

## Scope

One-off cash inflows/outflows booked in a single month, edited on the
"One-time" tab. Two bases:

- **fixed** (default; also any item without a `basis` field) — a dollar
  `amount`.
- **`pct`** — a percentage of an expense line: `pct`% of the linked expense's
  monthly value *in the item's month* (after scheduled changes and growth).
  Motivating case: "Deposit + first month" = 200% of Rent in the move month.

## Non-scope

- Recurring flows (those are income/expense line items).
- Linking to income lines or to other one-time items.
- Taxation of one-time amounts (entered gross/net by the user, see the
  note on the tab).

## Data / control flow

1. `simulate` (src/engine.js), per month, for each one-time whose `month`
   matches: `oneTimeAmount(o, expenses, abs, startAbs)` → added to `inflow`
   or `outflow` by `kind` ("in"/"out").
2. `oneTimeAmount`: `basis === "pct"` → find the expense by `o.itemId`,
   return `valueAt(expense, abs, startAbs) × pct/100`; missing expense → 0.
   Otherwise → `num(o.amount)`.
3. Because resolution happens against the expenses array passed to
   `simulate`, the rent solver's trial rent automatically scales linked
   items (the deposit grows as the solver probes higher rents), so the
   solved maximum accounts for the bigger move-in cost.
4. UI (src/App.jsx, `tab === "onetime"`): the Amount cell is a `$`/`%`
   selector plus a number input; `%` items get a sub-line to pick the
   expense, showing the resolved dollar value for the item's month.

## Related files

| File | Role |
|---|---|
| `src/engine.js` | `oneTimeAmount(o, expenses, abs, startAbs)` — exported; called per month in `simulate` |
| `src/engine.test.js` | Tests: fixed passthrough, changed-rent resolution, missing link → 0, solver trial follows |
| `src/App.jsx` | One-time tab editor; `makeDefaults()` links "Deposit + first month" to Rent at 200% |

## Invariants and constraints

- Item shape: `{ id, name, month, kind, amount, basis?, itemId?, pct?, disabled? }`.
  `basis` values other than `"pct"` (including `undefined` from old saved
  models) mean fixed — old saves keep working.
- `disabled: true` ("Skip" checkbox) makes `oneTimeAmount` return $0 while
  keeping the item's data; a linked one-time also resolves to $0 when its
  target expense is disabled.
- A `pct` item with a deleted/unset `itemId` resolves to $0 (it never falls
  back to the stale `amount`).
- The linked value is the expense's rate in the one-time's month — start/end
  windows apply, so linking to an expense that hasn't started yet gives $0.
- Feasibility stays monotone in the solver: raising rent only raises a
  rent-linked outflow, so bisection remains valid.
