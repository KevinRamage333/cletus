# Win-rate tuning replay (Nov 11, 2026)

`npx tsx --env-file=.env.local scripts/backtest/win-rate.ts` (raw numbers: `win-rate.json`).

Data: 8,207 scanner-eligible 5m decisions, $25k-$5M, 60 pools, 3.6 days of market_data OHLCV. 5 time folds;
anchored walk-forward (train folds 0..k-1, test fold k, k = 2..4). 792 configs: score 0.60-0.75, 10m buy-volume gate
off/x1/x2, min liquidity 0/30k/60k, 1h chase cap, first partial adaptive / +15/+20/+25% / 1R / 1.5R, sell 50/60%.
Selection on train: highest win rate with positive expectancy that is not below the current config's.

| out-of-sample (folds 2-4) | n | win | avg P&L/trade |
|---|---|---|---|
| current (0.65, buy-vol x1, adaptive exits, 15m fade) | 20 | 15.0% | -1.29% |
| walk-forward picks | 34 | 38.2% | -1.60% |
| current + $1,500 5m-volume floor (owner rule) | 29 | 17.2% | -2.31% |

Result: no tuned config beat the current one out-of-sample, so none was enabled. 70% was not reachable on this data.
Caveats: tiny n, 3.6 days, buy share is a close-location proxy (no real buy/sell split in OHLCV).
The $1,500 floor was enabled because the owner asked for it, not because the replay supported it.

## Momentum scalp (Nov 11, 8:57 PM CT request)

Entry: 5m buy share (close-location proxy) >= 0.55/0.6, green and rising 5m volume >= $5k, score >= 0.5-0.65.
Exit: SL -8%, +15% take (sell 75% + 5% trail, or 100%), 12-minute time stop under +3%, $1,500 volume exit.

| out-of-sample (folds 2-4) | n | win | avg P&L/trade |
|---|---|---|---|
| live now (current + $1,500 floor) | 29 | 17.2% | -2.31% |
| momentum scalp (walk-forward pick: 0.65, share 0.6, sell 75%) | 33 | 3.0% | -2.06% |

Negative, so not enabled live: `MOMENTUM_SCALP=dryrun` only logs would-be entries. Most scalps hit the time stop
and paid round-trip fees; the few that reached +15% averaged +14.7%.
