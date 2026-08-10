# Feature: Compare CLI (what-if variants)

## Scope

`npm run compare -- <variant.json>` — run a variant model and the baseline
(`data/model.json` by default) through the same `simulate` the app uses and
report the difference: what changed in the model, plan-level events, and
balance deltas at checkpoint months. Built for the agent workflow: propose
a change as a variant file, quote the impact, promote on approval.

## Non-scope

- Editing models (agents edit JSON directly; see persistence.md schema).
- Multi-scenario sweeps (base scenario only — by design; other scenarios
  only change investment returns) and chart overlays (possible later UI).

## Usage

```
npm run compare -- data/variants/rent-3600.json
npm run compare -- v.json --baseline other.json --at 2027-07,24,end --json
```

- `--at`: comma list of `YYYY-MM`, 1-based month offsets, or `end`.
  Default: the baseline's `settings.milestones` (planning dates that live
  in the model, e.g. "2027-07" = housemates start contributing), three
  evenly spaced points between the last milestone and the horizon, plus
  the end; without milestones, the horizon's quartiles.
- `--json`: full structured result for programmatic ranking of variants.

## Report contents

1. **What changed** — field-level diff (settings/solver by key; list items
   matched by `id`, showing changed fields / added / removed). Safety net:
   the report always states exactly what the variant touched, so an
   accidental extra edit is visible.
2. **Events** — lowest cash (amount and month), first cash-negative month,
   end net worth; each baseline → variant with delta.
3. **Checkpoints** — cash and total net worth at each checkpoint month,
   baseline → variant with deltas. Warnings when start month, horizon, or
   base-scenario rate differ between the two models.

## Conventions

- Variants live in `data/variants/<name>.json` (gitignored with data/),
  copied from `data/model.json` and edited. The live model is only touched
  when a human approves — "promote" = copy the variant over
  `data/model.json`; the running app adopts it within ~3 s.
- While the app is open, editing `data/model.json` directly can race its
  ~1 s autosave (last write wins) — another reason agents should work in
  variants and promote atomically.

## Related files

| File | Role |
|---|---|
| `scripts/compare.js` | CLI wrapper: args, file loading, human-readable report |
| `scripts/compare/core.js` | Pure logic: `parseCheckpoints`, `modelDiff`, `compareModels` |
| `scripts/compare/core.test.js` | Tests: checkpoint parsing/defaults, diffing, delta math, warnings |
| `src/engine.js` | The shared simulation both the app and this CLI run |

## Invariants and constraints

- Uses the same base-scenario rule as the app (second scenario in the list).
- `settings.milestones` is an optional array of `YYYY-MM` strings carried
  in the model (the engine ignores it); out-of-horizon milestones are
  dropped, falling back to quartiles.
- Checkpoints align by calendar month, so models with different start
  months still compare correctly over their overlap ("(out of range)" when
  a month exists in only one).
