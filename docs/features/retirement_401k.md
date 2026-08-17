# Feature: 401(k) contributions and employer match

## Scope

How the monthly pre-tax 401(k) contribution and the employer match are
computed inside the simulation, and the UI that configures them (the
"Accounts & 401(k)" tab). Two contribution styles:

- **`pct`** — contribute `pct401k`% of gross each month.
- **`maxEven`** — target the annual limit: each month contribute
  `(limit − YTD) / months left in the calendar year`, independent of gross.
  For a January start with steady income this is `limit / 12`; a mid-year
  start or a lean month redistributes over the remaining months so the
  limit still lands exactly in December.

`settings.ytd401k` ("already contributed this year") seeds the YTD counter
for the first calendar year of the simulation (both modes), so a mid-year
start doesn't re-contribute money that went in before `startMonth`.

## Non-scope

- Roth/after-tax or catch-up contributions, true-up matches, per-paycheck
  granularity, employer match vesting.
- Which account the money lands in (account routing is the simulation
  engine's concern: first `type === "retirement"` account).
- Taxation details beyond "contributions are pre-tax" (see tax_model).

## Data / control flow

1. `simulate` (src/engine.js) iterates months; each January it resets
   `ytd401k` — to `settings.ytd401k` in the start year, 0 in later years.
2. Per month it calls `contribution401k(settings, gross, ytd401k, monthIdx)`
   (`monthIdx` = 0 for January):
   - raw amount = `(limit401k − ytd) / (12 − monthIdx)` in `maxEven` mode,
     else `gross * pct401k / 100`;
   - clamped to `[0, min(remaining limit, gross)]`.
3. Employer match:
   - `pct` mode: matched percentage = `min(pct401k, matchCapPct)` — the
     *nominal election* is matched, even in a month where the limit clamp
     reduced the actual contribution (pre-existing behavior, kept).
   - `maxEven` mode: there is no elected percentage, so the *effective*
     percentage `c401 / gross * 100` is used, then capped by `matchCapPct`.
   - Either way: `match = gross * matchedPct/100 * matchPct/100`.
4. `c401` reduces taxable income (`annualTax(gross*12, c401*12, …)`) unless
   the flat-tax override is on; `c401 + match` is deposited into the first
   retirement account.
5. UI (src/App.jsx, `tab === "accounts"`): a "Contribution style" select
   writes `settings.mode401k`; in `maxEven` mode the percentage input is
   replaced by a read-only display of the first month's contribution.
   "Already contributed this year" edits `settings.ytd401k`. The note under
   the fields restates the month's contribution + match.

## Related files

| File | Role |
|---|---|
| `src/engine.js` | `contribution401k(settings, gross, ytd401k)` — exported; match logic inline in `simulate` |
| `src/engine.test.js` | Tests: even split hits limit exactly, January reset, gross clamp, effective-pct match, pct-mode regression |
| `src/App.jsx` | `makeDefaults()` seeds `mode401k: "pct"`; Accounts tab renders the selector |

## Invariants and constraints

- `settings.start401k` ("YYYY-MM"; ""/missing = from the sim start) zeroes
  both the contribution and the employer match for months before it — used
  to defer enrollment (e.g. skip a late-year catch-up and start fresh in
  January). From that month, `maxEven` splits the remaining limit over the
  months left in that calendar year as usual, and the calendar-year tax
  pass sees the smaller deduction automatically.
- `mode401k` values other than `"maxEven"` (including `undefined` from old
  saved/imported models — the load merge is shallow) behave as `"pct"`;
  a missing `ytd401k` behaves as 0.
- In `maxEven` mode any calendar year whose months have sufficient gross
  contributes exactly `limit401k − starting YTD`, finishing in December —
  including partial first years (mid-year `startMonth`).
- A month's contribution never exceeds that month's gross, and never pushes
  the calendar-year total past `limit401k`; if gross clamps a month in
  `maxEven` mode, later months in the year absorb the difference.
- `ytd401k` applies only to the calendar year containing `startMonth`;
  every later January resets YTD to 0.
