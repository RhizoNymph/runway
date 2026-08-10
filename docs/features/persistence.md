# Feature: Persistence and the agent-editable model file

## Scope

Where the model lives, how it round-trips, and the exact JSON schema of
`data/model.json` — written so a person or an agent can edit the file
directly (e.g. reconciling budgeted amounts against real spending) and
have the running app pick the changes up.

## Non-scope

- What the numbers mean to the simulation (see the other feature docs).
- Multi-user or concurrent-writer safety (last write wins).

## How it works

- **Dev / preview server** (`npm run dev`): a Vite middleware
  (`modelStore()` in `vite.config.js`) serves `GET/PUT /api/model`, backed
  by `data/model.json` (pretty-printed, gitignored). Every response sets
  `X-Model-Store: 1` so the client can tell the real endpoint from a
  static host's catch-all.
- **The app** (`store` in `src/App.jsx`): on load, `GET /api/model`; if the
  header is present, file mode. A 404 (no file yet) migrates the browser's
  localStorage copy — the file is created on the first autosave. Without
  the header/server (static build, `file://`), it falls back to
  localStorage under `budget-model-v1` exactly as before.
- **Autosave**: 900 ms after the last edit, the app PUTs
  `JSON.stringify(model, null, 2)`; skipped if identical to the last
  read/written text (`lastSaved` ref).
- **External edits**: while in file mode the app polls every 3 s (and on
  window focus), adopting file content that differs from `lastSaved`.
  Invalid/mid-write JSON is ignored and retried. Editing the file while
  simultaneously typing in the app inside the same second is last-write-wins.
- **Export / Import** buttons still move the same JSON as a download/upload.

## Editing the file (agent instructions)

Run the app with `npm run dev` (or edit cold — the app reads the file on
next launch). Edit `data/model.json`; the UI refreshes within ~3 s. Keep
`id` values stable for existing entries; new entries need any unique string
id. All amounts are **monthly dollars** (one-times are single-shot).
Months are `"YYYY-MM"`; `""` means "unbounded / not set".

**Testing a change before applying it**: don't edit `data/model.json`
speculatively. Copy it to `data/variants/<name>.json`, edit the copy, and
run `npm run compare -- data/variants/<name>.json` (add `--json` for
structured output) to see the impact at the plan's milestone months and
horizon — see docs/features/compare_cli.md. Only copy a variant over
`data/model.json` after the human approves.

```jsonc
{
  "settings": {
    "startMonth": "2026-08",      // first simulated month
    "horizonMonths": 60,           // 1–600
    "filing": "single",            // "single" | "married"
    "stateTax": "CA",              // "CA" | "custom" | "none"
    "stateRate": 0,                //  %; used when stateTax = "custom"
    "useFlatTax": false,           // true → flat flatTaxRate% instead of brackets
    "flatTaxRate": 33,
    "inflation": 3,                // %/yr; "apply to all" button default
    "milestones": ["2027-07"],     // optional YYYY-MM planning dates; the
                                   //   compare CLI uses them as default
                                   //   checkpoints (engine ignores them)
    "mode401k": "pct",             // "pct" | "maxEven" (spread limit over the year)
    "pct401k": 10,                 //  % of gross, pct mode
    "limit401k": 23500,            // annual cap
    "ytd401k": 0,                  // already contributed this calendar year
    "matchPct": 50,                // employer matches this % ...
    "matchCapPct": 6               // ... of at most this % of gross
  },
  "incomes":  [ /* item */ ],      // gross monthly amounts
  "expenses": [ /* item */ ],
  // item = {
  //   "id": "x", "name": "Rent",
  //   "amount": 2200,             // $ per occurrence (per month, or per year
  //                               //   when cadence = "yearly")
  //   "cadence": "monthly",       // optional; "yearly" charges once a year
  //   "cadenceMonth": 3,          //   ...in this calendar month (1–12;
  //                               //   invalid/missing behaves as January)
  //   "growth": 3,                // %/yr, compounds yearly
  //   "startMonth": "",           // "" = from the beginning
  //   "endMonth": "",             // inclusive last month; "" = forever
  //   "changes": [ { "id": "c", "month": "2026-10", "amount": 3800 } ],
  //                               // replaces amount from that month on
  //   "disabled": false           // true = "Skip": excluded, data kept
  // }
  "oneTimes": [
    { "id": "o", "name": "Movers", "month": "2026-10", "amount": 6000,
      "kind": "out",               // "in" | "out"
      "basis": "pct",              // optional; "pct" links to an expense:
      "itemId": "<expense id>",    //   amount = pct% of that line that month
      "pct": 200,                  //   (fixed "amount" ignored while linked)
      "disabled": false }
  ],
  "accounts": [
    { "id": "a", "name": "Checking", "type": "cash",   // cash|invest|retirement
      "balance": 25000,
      "returnMode": "fixed",       // "fixed" (fixedRate) | "scenario"
      "fixedRate": 4,              // %/yr, compounded monthly
      "contribMode": "none",       // none | fixed ($/mo) | pct (% of the
                                   //   month's leftover; $0 in shortfalls)
      "contrib": 0,
      "primary": true,             // exactly one: leftover lands here
      "capAmount": 30000,          // >0: keep at most this much ...
      "overflowTo": "<account id>",// ... excess moves here monthly (and the
                                   //   backstop pulls back to avoid negatives)
      "overflowStart": ""          // "YYYY-MM": link dormant before this month
                                   //   (both directions); "" = active always
    }
  ],
  "scenarios": [                   // the SECOND entry drives headline stats
    { "id": "s", "name": "Base", "rate": 7, "color": "#0E7C86" }
  ],
  "solver": { "itemId": null, "fromMonth": "", "cashFloor": 15000,
              "endTarget": 0, "useEndTarget": false }
}
```

## Related files

| File | Role |
|---|---|
| `vite.config.js` | `modelStore()` middleware: GET/PUT `/api/model` ↔ `data/model.json` |
| `src/App.jsx` | `store` (load/save + mode detection), autosave effect, file-watch effect |
| `data/model.json` | The live model (created on first save; gitignored) |

## Invariants and constraints

- The file, when present, is the source of truth; localStorage is only a
  fallback and a one-time migration source.
- Loads are merged shallowly over `makeDefaults()` — missing top-level keys
  get defaults, but a present `settings` object replaces the default one
  wholesale, so engine code must tolerate missing individual fields.
- PUT validates JSON syntax only, not the schema; the app additionally
  requires a `settings` key before adopting content.
- Writes are pretty-printed with a trailing newline for clean diffs.
