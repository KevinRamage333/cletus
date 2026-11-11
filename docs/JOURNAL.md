# Trade journal + daily review

All flags default off. Nothing here trades, sizes, or moves funds (feedback can only raise the score bar).

## Journal (`TRADE_JOURNAL=on`, `src/lib/trade-journal.ts`, engine hooks in `tryEnter` / `closePositionInner`)
`logs/trade-journal.jsonl` (`TRADE_JOURNAL_PATH`), one line per event, live and paper:
- **entry** (the why): score, threshold, weight set + active liquidity weights, the 8 classic signals, **all 6 liquidity
  terms** (liquidityBuild, velocitySurge, volumePersistence, freshness, antiChase, dipInUptrend), mcap, liquidity,
  24h volume, age, 1h/24h change, volatility (%/h), market mood (regime label, median 1h move, breadth), size, fees,
  quoted vs filled price (entry slippage), the adaptive exit plan (live).
- **exit** (the what): reason, hold minutes, MFE/MAE, total fees, exit slippage vs the observed price, cost, P&L $ and %,
  partials. Joined to the entry by `positionId`.

Retraining: `scripts/retrain-weights.ts` uses journaled trades (all 6 terms, full-score IC) for the closed-trade veto
once there are >= 20 of them; until then it keeps the 3-term partial from the DB.

## Daily review (`scripts/daily-review.ts`, `src/lib/trade-review.ts`)
    npx tsx --env-file=.env.local scripts/daily-review.ts [--day YYYY-MM-DD] [--days 7]
Writes `logs/reviews/YYYY-MM-DD.md` and `logs/reviews/flags.json`. Sources: the journal, plus closed DB positions it
doesn't have (backfill: mcap rebuilt from market_data, live MFE/MAE from exit-plans.json). Groups the rolling window
by book, score bucket, signal profile (liq / vel / calm|chase), mcap band, entry time of day (CT), exit reason.
A setup is **flagged** at n >= 5, avg P&L <= -1%, win rate <= 45%, net loss, and >= 2 points worse than the window
average. `TRADE_REVIEW_SCHEDULE=on`: the worker checks ~3 min after start and hourly; writes yesterday's review if
missing, else refreshes today's after 20 h (separate `nice` process).

## Feedback (`JOURNAL_FEEDBACK=on`, default off)
Only entry-time flags (signal profile, mcap band, time of day) from a flags.json < 48 h old: the candidate needs
score >= threshold + 0.025 per matched flag, capped at +0.05. Exit reason and score bucket are report-only.
