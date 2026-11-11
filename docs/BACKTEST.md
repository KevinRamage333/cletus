# Cletus backtest and calibration

**Run it:** `npm run backtest:backfill` (optional; at most 2 GeckoTerminal calls/min, resumable), then
`npm run backtest -- --size 25 --out docs/backtest` (or `--size 500`). Add `--write-calibration src/lib/backtest/calibration.json`
to refresh the table the Brain reads. Reports: `docs/backtest/REPORT-clip25.md` and `REPORT-clip500.md` (+ JSON).

## How it works
- **Data:** `market_data.ohlcv_5m` (5-minute GeckoTerminal candles) and `market_data.pool_snapshots`, both in the LLC's own Postgres.
- **No lookahead:** at each 5-minute close the harness rebuilds the DexScreener-style snapshot from candles at or before that moment
  (`src/lib/backtest/replay.ts → snapshotAt`, unit-tested by mutating future candles). That snapshot goes through the **real**
  `rankCandidates()` (filters, `computeSignals`, `compositeScore`, fee penalty) with the live learned weights.
- **Trades:** real `exitDecision()` + partial-TP ladder, entry at the decision close plus slippage. Intrabar path O→L→H→C on up bars
  and O→H→L→C on down bars, so stops see the low first. Level exits fill at the level, or at the open if price gapped through it.
- **Costs:**
  - Jupiter V2 fee from `expectedFeeBps()`: 50 bps per side under 24 h, 10 bps after.
  - Operator 0.5% only in the "customer" rows.
  - Constant-product price impact (`simFillPrice`).
  - 30 bps per side slippage, plus 100 bps extra on stop-type exits.
  - Network and priority fee.
- **Portfolio:** one position per pool, at most 20 open, and the 60% exposure cap.
- **Selection:**
  - Weights are chosen only on the earlier 60% of time (train) and reported on the later 40% (test).
  - Candidate weights are live, defaults, and train-IC-weighted with and without the new features.
  - Thresholds run from 0.20 to 0.90.
  - The objective is the lower confidence bound of expectancy, which penalises small samples.
  - A 3-fold expanding walk-forward is also run.
- **Calibration:**
  - Isotonic score → P(win) is fit on train, then Brier is compared to the base rate on test.
  - The Brain only quotes a score-specific probability if it beats the base rate by at least 2% out of sample. Otherwise it quotes the market-cap band's base rate (`src/lib/calibration.ts`, Brain tool `get_backtest`, `historicalConfidence` on scan candidates).

## Proxies (GeckoTerminal OHLCV has no txn counts or liquidity history)
- **Buy/sell split:** from the candle close-location value. Counts scale with volume. This affects `velocitySurge` and `microCapHeat`.
- **Liquidity:** `liq_now × sqrt(p_t / p_now)`, which is exact for a constant-product pool with no LP adds or removes.
- **Market cap:** `close × (fdv_now / price_now)`.
- **24 h volume:** extrapolated from the past only when fewer than 24 h of candles exist.
- Holder growth, RugCheck and dev-wallet flags have no history, so they are **not testable** here. The audit gate is not simulated.

## Result (dataset 2fba42d2e159, 60 usable pools, 46,789 candles, mostly Nov 8–11 2026)
- **The current score ranks backwards.** Its out-of-sample IC versus net trade return is negative in Degen and Balanced, and near zero in Safer:
  - Degen: −0.18 to −0.23
  - Balanced: −0.14 to −0.16
  - Safer: −0.03 to +0.04
- **Which signals are which:**
  - Momentum, breakout and buy-pressure (chasing) are consistently negative.
  - Liquidity depth and velocity are consistently positive.
  - Volume persistence is ≈ 0.
  - Trend alignment, higher-lows, freshness and dip-in-uptrend are not positive out of sample.
- **No tested configuration had positive out-of-sample expectancy after costs.** This includes IC-reweighting, any threshold, the new pattern features, and hold 6–120 min with SL 5/10 and TP 15/25. At the live 0.75 threshold the replay takes almost no trades. Loosening it loses money out of sample, so 0.75 is not "too strict."
- **What did and did not ship:** IC-weighting improved ranking (less negative top-decile returns in Degen and Balanced) but stayed negative. So **no weight, threshold, feature or exit change was shipped.** What shipped is the harness and the honest calibration.
- **The 7 live paper trades agree.** They were scored 0.69–0.90, and 1 of 7 won (net −$311).

## Caveats
- **Small sample:** about 3.5 days, 10–28 eligible pools per preset, and one market regime.
- **Survivorship bias:** pools were discovered from today's trending, top-volume and new lists, so rugs that died before today are missing.
- **Overlapping decision labels** in the IC and calibration tables.
- **Proxies** are listed above.
- **Dead or missing pools:** 8 pools failed backfill on a duplicate-bucket bug (fixed since). 25 had fewer than 100 candles.

## Whale flow and X hype
The harness now loads `market_data.whale_swaps` and the X mention tables. It evaluates the whale veto (mean net return of vetoed vs kept decisions) and the IC of whale net flow and flow ratio using swaps strictly before each decision. It only does this once there is at least 72 h of history on at least 20 backtest tokens. As of this run there are 169 swaps on 4 tokens over 1 h, and no X data (no `X_BEARER_TOKEN`), so it reports **not evaluable yet**. See docs/FLOW_SIGNALS.md.

## Exit styles for the live owner (2026-11-11, `scripts/backtest/adaptive-exits.ts`)
Same entries for every style: liquidity weight set, score ≥ 0.60, $70k–$5M, 1 open position, $6 clip, same cost model.
Test-window expectancy per trade (n trades) for four train/test splits:

| split (train share) | fixed 5% / 20% | fixed taper (SL 20, 50%@+50, BE, 8% trail, +150, stale 120m ±3%) | adaptive | adaptive + learning |
|---|---|---|---|---|
| 0.4 | −0.31% (24) | −0.29% (18) | +1.04% (21) | +0.30% (25) |
| 0.5 | +0.03% (19) | +0.23% (15) | +0.13% (26) | +2.84% (23) |
| 0.6 | −0.93% (22) | +0.56% (11) | +0.11% (22) | +1.75% (20) |
| 0.7 | −2.31% (23) | +1.97% (7) | +0.79% (16) | +3.29% (14) |

- Fixed 5/20 is stopped out by ordinary noise (about 75% of its exits are stop-losses).
- The fixed taper rarely reaches +50%; most of its trades end at the 2-hour stale exit, so the single slot sits idle and it takes about half as many trades.
- Adaptive plans (median stop ≈ 10%) take about twice as many trades with few stop-outs; adding the learning loop was positive on every split.
- Worst single trade in some splits was −22% (fixed taper) to −27% (adaptive), because 5-minute bars gap through stops; live checks every 3 s plus the Helius pool WebSocket, so gaps should be smaller live, but a rug can still gap.
- **Caveat:** 3.6 days, one regime, 14–26 test trades per cell. This is "not worse and probably better", not a proven edge.

## Volume-fade exit replay (2026-11-11)

`npx tsx --env-file=.env.local scripts/backtest/volume-fade.ts --thr 0.6,0.65` — live adaptive+learning exits, $6 clip, 1 slot,
$70k–$5M, liquidity weight set; fade checked at each 5m bar close vs the mean 5m volume of the 12 bars before entry; only fires
below +15% and before the first partial. Buy share is a close-location proxy (OHLCV has no buy/sell split), so the sell-side
rule is weakly tested. 3.6 days, 60 pools, 60/40 time split.

| fade (vol share / minutes / buy share) | train n, exp% | test n, hit, exp%, $ | fades train/test |
|---|---|---|---|
| none (score 0.60) | 32, +0.36% | 20, 35%, +1.75%, +$2.10 | 0/0 |
| 10% / 15 min / 20% | 40, −0.69% | 25, 24%, −0.88%, −$1.32 | 15/6 |
| **10% / 20 min / 20% (chosen)** | 31, +0.69% | 22, 27%, +1.30%, +$1.71 | 7/3 |
| 20% / 20 min / 20% | 35, +0.45% | 26, 19%, −0.38%, −$0.59 | 12/6 |
| 30% / 15 min / 20% | 56, −0.47% | 34, 29%, +0.63%, +$1.28 | 35/20 |
| 10% / 30 min / 20% | 33, +0.72% | 20, 35%, +1.74%, +$2.09 | 2/0 |

Read: 15-minute windows and looser volume cuts shake trades out of coins that are only pausing (worse in both halves).
The strictest 15–20 min setting (10% of entry volume for 20 min) is roughly neutral: better in train (+$0.60), worse in test
(−$0.39). It mainly frees the slot sooner (more trades/day); it is not a proven edge on this sample.
