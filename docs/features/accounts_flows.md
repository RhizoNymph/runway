# Feature: Accounts and monthly money flows

## Scope

How each simulated month's money moves between accounts: deliberate
transfers, the "leftover lands here" primary account, 401(k) routing, and
the balance-cap **overflow waterfall** (keep a cash cushion, invest the
rest). Edited on the "Accounts & 401(k)" tab.

## Non-scope

- How the surplus itself is computed (income, taxes, expenses — see
  simulation_engine / tax_model / retirement_401k).
- General withdrawals or rebalancing out of investment accounts — money
  flows backwards only through the overflow-link backstop described below.

## Data / control flow (per month, in `simulate`, src/engine.js)

1. **Transfers**: every non-primary, non-retirement account with a monthly
   deposit configured receives it — fixed `$`, or `%` of the month's
   **leftover** (net + one-time inflows − expenses − one-time outflows,
   before transfers). Percentage deposits therefore self-throttle: a lean
   month transfers less, a shortfall month transfers $0. Fixed deposits are
   unconditional.
2. **Surplus** = leftover − transfers. It lands in the **primary** account
   (first with `primary: true`; index 0 if none). Negative surplus drains
   the primary — fixed transfers are not throttled by available cash.
3. **401(k)**: employee contribution + employer match land in the first
   `type === "retirement"` account.
4. **Overflow**: any account with `capAmount > 0` and a valid `overflowTo`
   holding more than its cap moves the excess to the destination, leaving
   exactly `capAmount` behind. Runs in list order with up to
   `accounts.length` passes, so chains (cash → bonds → stocks) cascade
   within the same month; a cycle terminates after the bounded passes.
5. **Backstop**: an account left **negative** after the overflow pass pulls
   money back along its overflow chain — from its destination first, then
   that account's destination, and so on (visited-set stops cycles) — but
   only enough to reach exactly $0, bounded by each source's positive
   balance. It never proactively refills to the cap; a balance merely below
   its cap rebuilds from future leftovers instead of by selling. Cash goes
   negative only once the entire chain is drained.
6. **Growth**: every balance compounds at `rate / 12` (fixed rate or the
   scenario rate), after overflow and backstop — money moved this month
   earns its destination's rate this month.

## Related files

| File | Role |
|---|---|
| `src/engine.js` | Flow + overflow logic inside `simulate` |
| `src/engine.test.js` | "leftover overflow between accounts" suite: fill-to-cap, pre-existing excess, no-op cases, chain cascade, under-cap months |
| `src/App.jsx` | Accounts tab: per-account "holds at most … then overflow to …" controls (hidden for retirement accounts); defaults cap checking at $30k → brokerage |

## Invariants and constraints

- Account shape adds `capAmount` (number; 0/missing = no cap) and
  `overflowTo` (account id; ""/missing/unknown/self = nowhere). Old saved
  models therefore behave exactly as before.
- Overflow applies to the **whole balance**, not just this month's inflow —
  a starting balance above the cap is swept in month one.
- The link is asymmetric: excess above the cap always moves on, but money
  comes back only to prevent a negative balance (to $0, never to the cap).
  Both directions require the same active link (`capAmount > 0` + valid
  `overflowTo`), per hop in a chain.
- `overflowStart` ("YYYY-MM") delays the link: before that month it is
  dormant in **both** directions — no sweep, no backstop — exactly as if
  unconfigured. Empty/invalid means active from the start. Per hop, like
  the rest of the link conditions.
- Retirement accounts get no overflow UI (tax-sheltered money shouldn't
  leak out), but the engine itself doesn't special-case them — an imported
  model could set a cap on one.
- The solver's cash floor reads cash-type balances, so a cap below the
  solver's floor on the only cash account makes the floor unreachable
  (the solver will report infeasible/tight, which is truthful).
