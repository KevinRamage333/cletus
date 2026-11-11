# Nightly self-retraining (entry score)

Retrains the live entry score: the 6 weights of the `liquidity` set (`LIQUIDITY_WEIGHTS` in `src/lib/signals.ts`) and the
score threshold (`MIN_COMPOSITE_SCORE`). Everything is off by default. It never trades, moves funds or touches the DB beyond reads.

## Method (`src/lib/retrain/core.ts`, `scripts/retrain-weights.ts`)
- Data: every scanner-eligible 5m snapshot in `market_data` ($70k-$5M, the real `rankCandidates` filters) becomes a decision
  with its 6 liquidity terms and fee penalty. Trades replay the live owner setup: 1 open position, the adaptive exit plan
  computed from the candidate's own score, fees + AMM impact + slippage, no lookahead (same primitives as `scripts/backtest`).
- Split: the newest 30% of time is the holdout and is never used by the search. The older 70% has a warm-up block and
  3 walk-forward validation folds.
- Candidates: current set, each single term ±0.05, 60 seeded random moves within ±0.05 per weight (floor 0.02, sum 1),
  each at 5 thresholds within ±0.05 of the current one, clamped to 0.55-0.75 (365 total). Fitness on the folds is
  mean - 0.5·sd of the summed pnl% per fold.
- Promotion (all gates must pass on the holdout): >= 15 trades; summed pnl% beats current by >= 25 (a quarter of one
  trade's size); per-trade expectancy no worse than current - 0.25pp; does not lose to current in a majority of 3
  holdout blocks; within nightly bounds; and if >= 20 real closed trades exist, their rank correlation with the
  (partial, 3-term) score may not drop by more than 0.1.

## Storage and logs
- `data/weight-sets/registry.json` (gitignored): versions with weights, threshold, parent and full metrics; `activeId`,
  `previousId`, `lastRunAt`. Version `default` is always the hand-built set. Invalid or corrupt entries fall back to default.
- `logs/retrain.jsonl`: one line per dry-run / reject / promote / rollback / worker load.

## Commands
    npx tsx --env-file=.env.local scripts/retrain-weights.ts                 # dry run, changes nothing
    npx tsx --env-file=.env.local scripts/retrain-weights.ts --apply         # promote if every gate passes
    npx tsx --env-file=.env.local scripts/retrain-weights.ts --status
    npx tsx --env-file=.env.local scripts/retrain-weights.ts --rollback      # previous (or: default, <id>)

## Flags (live worker; all default off; need one restart to take effect)
- `RETRAINED_WEIGHTS=on`: load the active set + threshold at startup. Off = hand-built weights + env threshold.
- `WEIGHTS_HOT_RELOAD=on`: re-apply within 60 s when the registry changes (promotion or rollback).
- `RETRAIN_SCHEDULE=on`: hourly (and 2 min after start) check; if the last run is >= `RETRAIN_EVERY_HOURS` (20) old,
  run `--apply --if-due` in a separate `nice -n 19` process (lock file `logs/retrain.lock`). The box sleeps when idle,
  so "nightly" means "first check after 20 h", which catches up on wake.

Rollback is instant with hot reload on (`--rollback`), otherwise it applies at the next restart. Unsetting
`RETRAINED_WEIGHTS` returns to the hand-built set at the next restart.
