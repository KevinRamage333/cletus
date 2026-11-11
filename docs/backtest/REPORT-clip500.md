# Cletus backtest report

Generated 2026-11-11T17:16:55.033Z · dataset d6c54ef5b488 · 60 pools · 46,789 five-minute candles · 2026-10-29T13:15:00.000Z → 2026-11-11T17:15:00.000Z (UTC) · clip $500

Pools by discovery source: collector 19, topvol 10, trending24h 31

All returns are net of Jupiter fees (50 bps/side under 24 h, 10 bps after), AMM price impact, 30 bps/side slippage, +100 bps on stop-type exits, and network fees. "Owner" = no operator fee; "customer" = 0.5% operator fee per side. Test = later, unseen time window.

## Degen $10k-$500k

Snapshots 42,943 · eligible after filters 1,861 (13 pools)

Split: train 2026-11-08T03:00:00.000Z → 2026-11-10T06:15:00.000Z, test → 2026-11-11T16:25:00.000Z

| | trades | hit rate | avg win | avg loss | expectancy | profit factor | max DD | Sharpe/trade |
|---|---|---|---|---|---|---|---|---|
| baseline (live weights @ 0.75) train | 0 | – | –% | –% | –% | – | 0.00% | – |
| baseline TEST | 0 | – | –% | –% | –% | – | 0.00% | – |
| baseline TEST (customer fee) | 0 | – | –% | –% | –% | – | 0.00% | – |
| chosen (icAll @ 0.525) train | 15 | 26.7% | 5.73% | -3.45% | -1.00% | 0.60 | 0.77% | -0.20 |
| chosen TEST | 57 | 14.0% | 5.72% | -6.37% | -4.67% | 0.15 | 13.31% | -0.93 |
| chosen TEST (customer fee) | 57 | 14.0% | 5.10% | -6.84% | -5.17% | 0.12 | 14.73% | -1.04 |
| joint score+exits (icAll @ 0.525, hold60_sl5_tp15) train | 13 | 38.5% | 12.09% | -3.88% | 2.26% | 1.95 | 1.17% | 0.27 |
| joint TEST | 56 | 12.5% | 7.87% | -7.61% | -5.68% | 0.15 | 15.89% | -1.00 |
| joint TEST (customer fee) | 56 | 12.5% | 7.04% | -8.05% | -6.16% | 0.12 | 17.26% | -1.11 |
| walk-forward baseline (3 folds OOS) | 0 | – | –% | –% | –% | – | 0.00% | – |
| walk-forward chosen (3 folds OOS) | 97 | 9.3% | 6.27% | -5.25% | -4.18% | 0.12 | 20.28% | -0.93 |
| walk-forward joint (3 folds OOS) | 66 | 19.7% | 6.76% | -7.67% | -4.82% | 0.22 | 15.93% | -0.64 |

Walk-forward picks: fold 1: defaults@0.325; fold 1 joint: icAll@0.45 hold60_sl10_tp15; fold 2: live@0.325; fold 2 joint: icBase@0.675 hold30_sl10_tp15; fold 3: icBase@0.675; fold 3 joint: icBase@0.65 hold30_sl10_tp15

Ranking quality, threshold-free (TEST decisions; mean net return of the top q% by each score):

| scorer | top 2% | top 5% | top 10% | top 25% | all |
|---|---|---|---|---|---|
| live | -5.61% (win 13%, n=23) | -4.94% (win 16%, n=56) | -5.19% (win 12%, n=113) | -5.21% (win 9%, n=282) | -4.55% (win 7%, n=1127) |
| defaults | -5.82% (win 9%, n=23) | -4.99% (win 16%, n=56) | -5.19% (win 12%, n=113) | -5.13% (win 9%, n=282) | -4.55% (win 7%, n=1127) |
| icBase | -4.54% (win 4%, n=23) | -4.12% (win 9%, n=56) | -4.68% (win 7%, n=113) | -4.45% (win 8%, n=282) | -4.55% (win 7%, n=1127) |
| icAll | -4.93% (win 13%, n=23) | -4.69% (win 14%, n=56) | -4.71% (win 12%, n=113) | -4.58% (win 10%, n=282) | -4.55% (win 7%, n=1127) |
| icShippable | -4.93% (win 13%, n=23) | -4.69% (win 14%, n=56) | -4.71% (win 12%, n=113) | -4.58% (win 10%, n=282) | -4.55% (win 7%, n=1127) |

Each scorer at the live threshold 0.75 (TEST portfolio): live: n=0, exp –%; defaults: n=0, exp –%; icBase: n=8, exp -4.68%; icAll: n=1, exp -2.88%; icShippable: n=1, exp -2.88%

Live weights, threshold sweep (train | test):

| threshold | train n | train exp | test n | test hit | test exp |
|---|---|---|---|---|---|
| 0.3 | 63 | -2.55% | 216 | 10.6% | -5.04% |
| 0.4 | 21 | -2.68% | 94 | 12.8% | -5.09% |
| 0.5 | 8 | -0.51% | 39 | 17.9% | -5.05% |
| 0.55 | 4 | 1.35% | 27 | 14.8% | -5.15% |
| 0.6 | 0 | –% | 11 | 0.0% | -7.46% |
| 0.65 | 0 | –% | 6 | 0.0% | -8.40% |
| 0.7 | 0 | –% | 2 | 0.0% | -8.48% |
| 0.75 | 0 | –% | 0 | – | –% |

Information coefficient (Spearman of signal vs net trade return; and vs raw 60-min forward return):

| signal | IC train | IC test | IC60 train | IC60 test |
|---|---|---|---|---|
| volumeSpike | 0.032 | -0.255 | 0.071 | -0.085 |
| momentum | -0.100 | -0.145 | -0.098 | -0.086 |
| breakout | -0.040 | -0.158 | -0.065 | -0.069 |
| velocitySurge | 0.036 | 0.027 | 0.063 | 0.059 |
| microCapHeat | -0.080 | -0.138 | -0.043 | -0.030 |
| nanoCapSpike | – | – | – | – |
| liquidityBuild | 0.073 | 0.196 | 0.032 | 0.104 |
| volMcapRatio | -0.087 | -0.300 | 0.093 | -0.154 |
| volumePersistence | 0.014 | -0.004 | 0.035 | -0.006 |
| trendAlignment | -0.024 | -0.103 | -0.087 | -0.126 |
| freshness | -0.081 | -0.019 | 0.033 | 0.088 |
| dipInUptrend | 0.050 | -0.065 | -0.005 | -0.100 |
| higherLows | -0.128 | -0.011 | -0.067 | 0.023 |
| liveComposite | -0.038 | -0.226 | -0.001 | -0.120 |

Calibration (live score; isotonic fit on train). Test Brier 0.0746 vs base-rate 0.0677 (lower is better). Train win rate 8.8%.

| score bucket | test n | test win rate (95% CI) | test mean net |
|---|---|---|---|
| 0–0.2 | 567 | 6.9% (5%–9%) | -4.05% |
| 0.2–0.3 | 309 | 6.1% (4%–9%) | -4.97% |
| 0.3–0.4 | 144 | 7.6% (4%–13%) | -5.17% |
| 0.4–0.5 | 64 | 7.8% (3%–17%) | -5.30% |
| 0.5–0.6 | 32 | 25.0% (13%–42%) | -4.02% |
| 0.6–0.7 | 9 | 0.0% (0%–30%) | -7.24% |
| 0.7–0.8 | 2 | 0.0% (0%–66%) | -8.48% |
| 0.8–1 | 0 | – (–––) | –% |

Calibration (chosen score; isotonic fit on train). Test Brier 0.0693 vs base-rate 0.0677 (lower is better). Train win rate 8.8%.

| score bucket | test n | test win rate (95% CI) | test mean net |
|---|---|---|---|
| 0–0.2 | 146 | 4.1% (2%–9%) | -5.23% |
| 0.2–0.3 | 596 | 7.4% (6%–10%) | -4.37% |
| 0.3–0.4 | 205 | 7.8% (5%–12%) | -4.30% |
| 0.4–0.5 | 103 | 5.8% (3%–12%) | -4.91% |
| 0.5–0.6 | 54 | 13.0% (6%–24%) | -4.82% |
| 0.6–0.7 | 17 | 5.9% (1%–27%) | -5.99% |
| 0.7–0.8 | 6 | 33.3% (10%–70%) | -1.92% |
| 0.8–1 | 0 | – (–––) | –% |

Exit sensitivity (chosen score; ranked on train; current hold6_sl5_tp15):

| exits | train n | train exp | test n | test hit | test exp | test PF |
|---|---|---|---|---|---|---|
| hold60_sl5_tp15 | 13 | 2.26% | 56 | 12.5% | -5.68% | 0.15 |
| hold120_sl5_tp15 | 13 | 2.26% | 56 | 12.5% | -5.68% | 0.15 |
| hold60_sl5_tp25 | 13 | 1.56% | 56 | 12.5% | -5.84% | 0.12 |
| hold120_sl5_tp25 | 13 | 1.45% | 56 | 12.5% | -5.84% | 0.12 |
| hold60_sl10_tp15 | 13 | 1.52% | 55 | 27.3% | -4.80% | 0.33 |
| hold120_sl10_tp15 | 13 | 1.52% | 55 | 27.3% | -4.89% | 0.33 |

Top filter rejections: mcap outside $X (35498); pool liquidity < $X (5079); Nh volume < N% of mcap (316); Nh volume < $X (143); Nh move > N% (44); younger than Nh (2)

## Balanced $250k-$5M

Snapshots 42,943 · eligible after filters 8,207 (28 pools)

Split: train 2026-11-08T02:40:00.000Z → 2026-11-10T06:37:00.000Z, test → 2026-11-11T17:15:00.000Z

| | trades | hit rate | avg win | avg loss | expectancy | profit factor | max DD | Sharpe/trade |
|---|---|---|---|---|---|---|---|---|
| baseline (live weights @ 0.75) train | 0 | – | –% | –% | –% | – | 0.00% | – |
| baseline TEST | 0 | – | –% | –% | –% | – | 0.00% | – |
| baseline TEST (customer fee) | 0 | – | –% | –% | –% | – | 0.00% | – |
| chosen (icBase @ 0.75) train | 322 | 3.7% | 3.53% | -1.94% | -1.74% | 0.07 | 27.96% | -0.90 |
| chosen TEST | 617 | 6.0% | 2.69% | -2.41% | -2.11% | 0.07 | 65.00% | -0.84 |
| chosen TEST (customer fee) | 617 | 3.9% | 3.16% | -3.14% | -2.89% | 0.04 | 89.25% | -1.16 |
| joint score+exits (icBase @ 0.75, hold30_sl10_tp15) train | 126 | 10.3% | 8.16% | -2.39% | -1.30% | 0.39 | 8.33% | -0.30 |
| joint TEST | 255 | 18.4% | 4.71% | -3.98% | -2.38% | 0.27 | 30.29% | -0.45 |
| joint TEST (customer fee) | 255 | 14.9% | 4.94% | -4.57% | -3.15% | 0.19 | 40.22% | -0.60 |
| walk-forward baseline (3 folds OOS) | 0 | – | –% | –% | –% | – | 0.00% | – |
| walk-forward chosen (3 folds OOS) | 905 | 5.6% | 2.54% | -2.29% | -2.02% | 0.07 | 91.28% | -0.87 |
| walk-forward joint (3 folds OOS) | 307 | 17.9% | 5.32% | -4.52% | -2.76% | 0.26 | 42.32% | -0.47 |

Walk-forward picks: fold 1: icBase@0.65; fold 1 joint: icBase@0.625 hold60_sl10_tp15; fold 2: icBase@0.775; fold 2 joint: defaults@0.525 hold30_sl10_tp25; fold 3: icBase@0.775; fold 3 joint: icBase@0.75 hold30_sl10_tp15

Ranking quality, threshold-free (TEST decisions; mean net return of the top q% by each score):

| scorer | top 2% | top 5% | top 10% | top 25% | all |
|---|---|---|---|---|---|
| live | -3.97% (win 17%, n=105) | -3.81% (win 15%, n=262) | -3.74% (win 12%, n=524) | -3.52% (win 9%, n=1309) | -3.00% (win 8%, n=5235) |
| defaults | -4.06% (win 16%, n=105) | -3.83% (win 14%, n=262) | -3.82% (win 12%, n=524) | -3.53% (win 9%, n=1309) | -3.00% (win 8%, n=5235) |
| icBase | -1.19% (win 9%, n=105) | -1.55% (win 7%, n=262) | -1.62% (win 7%, n=524) | -2.22% (win 6%, n=1309) | -3.00% (win 8%, n=5235) |
| icAll | -1.19% (win 9%, n=105) | -1.55% (win 7%, n=262) | -1.62% (win 7%, n=524) | -2.22% (win 6%, n=1309) | -3.00% (win 8%, n=5235) |
| icShippable | -1.19% (win 9%, n=105) | -1.55% (win 7%, n=262) | -1.62% (win 7%, n=524) | -2.22% (win 6%, n=1309) | -3.00% (win 8%, n=5235) |

Each scorer at the live threshold 0.75 (TEST portfolio): live: n=0, exp –%; defaults: n=0, exp –%; icBase: n=617, exp -2.11%; icAll: n=617, exp -2.11%; icShippable: n=617, exp -2.11%

Live weights, threshold sweep (train | test):

| threshold | train n | train exp | test n | test hit | test exp |
|---|---|---|---|---|---|
| 0.3 | 238 | -2.83% | 603 | 12.1% | -3.67% |
| 0.4 | 91 | -2.84% | 243 | 13.6% | -3.85% |
| 0.5 | 28 | -2.23% | 78 | 17.9% | -4.20% |
| 0.55 | 13 | -4.41% | 37 | 13.5% | -5.26% |
| 0.6 | 1 | -7.66% | 15 | 0.0% | -6.90% |
| 0.65 | 0 | –% | 6 | 0.0% | -8.40% |
| 0.7 | 0 | –% | 2 | 0.0% | -8.48% |
| 0.75 | 0 | –% | 0 | – | –% |

Information coefficient (Spearman of signal vs net trade return; and vs raw 60-min forward return):

| signal | IC train | IC test | IC60 train | IC60 test |
|---|---|---|---|---|
| volumeSpike | -0.009 | -0.165 | 0.015 | 0.001 |
| momentum | -0.158 | -0.187 | -0.128 | -0.087 |
| breakout | -0.117 | -0.137 | -0.099 | -0.062 |
| velocitySurge | 0.014 | 0.021 | 0.025 | 0.028 |
| microCapHeat | -0.098 | -0.121 | -0.064 | -0.060 |
| nanoCapSpike | – | – | – | – |
| liquidityBuild | 0.105 | 0.160 | 0.106 | 0.088 |
| volMcapRatio | -0.030 | -0.201 | 0.067 | -0.023 |
| volumePersistence | -0.003 | 0.023 | 0.010 | 0.022 |
| trendAlignment | 0.001 | -0.019 | -0.113 | -0.090 |
| freshness | -0.066 | -0.031 | 0.021 | 0.118 |
| dipInUptrend | -0.010 | -0.097 | 0.007 | -0.068 |
| higherLows | -0.072 | -0.044 | -0.068 | 0.026 |
| liveComposite | -0.097 | -0.157 | -0.049 | -0.040 |

Calibration (live score; isotonic fit on train). Test Brier 0.0768 vs base-rate 0.0763 (lower is better). Train win rate 9.4%.

| score bucket | test n | test win rate (95% CI) | test mean net |
|---|---|---|---|
| 0–0.2 | 3340 | 8.3% (7%–9%) | -2.74% |
| 0.2–0.3 | 1161 | 5.9% (5%–7%) | -3.34% |
| 0.3–0.4 | 454 | 10.6% (8%–14%) | -3.55% |
| 0.4–0.5 | 196 | 12.8% (9%–18%) | -3.54% |
| 0.5–0.6 | 69 | 21.7% (14%–33%) | -3.50% |
| 0.6–0.7 | 13 | 0.0% (0%–23%) | -6.66% |
| 0.7–0.8 | 2 | 0.0% (0%–66%) | -8.48% |
| 0.8–1 | 0 | – (–––) | –% |

Calibration (chosen score; isotonic fit on train). Test Brier 0.0830 vs base-rate 0.0763 (lower is better). Train win rate 9.4%.

| score bucket | test n | test win rate (95% CI) | test mean net |
|---|---|---|---|
| 0–0.2 | 86 | 23.3% (16%–33%) | -3.37% |
| 0.2–0.3 | 346 | 16.8% (13%–21%) | -2.84% |
| 0.3–0.4 | 694 | 9.1% (7%–11%) | -2.73% |
| 0.4–0.5 | 1094 | 8.9% (7%–11%) | -3.57% |
| 0.5–0.6 | 759 | 7.9% (6%–10%) | -3.34% |
| 0.6–0.7 | 837 | 6.8% (5%–9%) | -3.24% |
| 0.7–0.8 | 828 | 4.7% (3%–6%) | -2.87% |
| 0.8–1 | 591 | 6.9% (5%–9%) | -1.67% |

Exit sensitivity (chosen score; ranked on train; current hold6_sl5_tp15):

| exits | train n | train exp | test n | test hit | test exp | test PF |
|---|---|---|---|---|---|---|
| hold30_sl10_tp15 | 126 | -1.30% | 255 | 18.4% | -2.38% | 0.27 |
| hold15_sl10_tp25 | 222 | -1.55% | 427 | 11.2% | -2.23% | 0.14 |
| hold6_sl10_tp25 | 320 | -1.69% | 597 | 5.4% | -2.06% | 0.06 |
| hold30_sl10_tp25 | 125 | -1.40% | 253 | 18.6% | -2.41% | 0.25 |
| hold15_sl10_tp15 | 222 | -1.60% | 428 | 11.2% | -2.20% | 0.16 |
| hold6_sl10_tp15 | 320 | -1.71% | 598 | 5.5% | -2.05% | 0.06 |

Top filter rejections: mcap outside $X (25258); Nh volume < N% of mcap (7849); pool liquidity < $X (1479); Nh move > N% (136); younger than Nh (7); Nh volume < $X (7)

## Safer $5M-$50M

Snapshots 42,943 · eligible after filters 2,879 (10 pools)

Split: train 2026-11-08T08:00:00.000Z → 2026-11-10T08:45:00.000Z, test → 2026-11-11T17:15:00.000Z

| | trades | hit rate | avg win | avg loss | expectancy | profit factor | max DD | Sharpe/trade |
|---|---|---|---|---|---|---|---|---|
| baseline (live weights @ 0.75) train | 0 | – | –% | –% | –% | – | 0.00% | – |
| baseline TEST | 0 | – | –% | –% | –% | – | 0.00% | – |
| baseline TEST (customer fee) | 0 | – | –% | –% | –% | – | 0.00% | – |
| chosen (icBase @ 0.8) train | 50 | 4.0% | 0.57% | -0.79% | -0.74% | 0.03 | 1.85% | -1.49 |
| chosen TEST | 73 | 2.7% | 0.18% | -0.94% | -0.91% | 0.01 | 3.32% | -2.12 |
| chosen TEST (customer fee) | 73 | 0.0% | –% | -1.71% | -1.71% | 0.00 | 6.23% | -3.99 |
| joint score+exits (icBase @ 0.375, hold120_sl10_tp15) train | 67 | 31.3% | 4.76% | -1.74% | 0.30% | 1.25 | 1.99% | 0.06 |
| joint TEST | 54 | 22.2% | 0.95% | -1.72% | -1.13% | 0.16 | 3.06% | -0.45 |
| joint TEST (customer fee) | 54 | 5.6% | 2.50% | -2.18% | -1.92% | 0.07 | 5.19% | -0.77 |
| walk-forward baseline (3 folds OOS) | 0 | – | –% | –% | –% | – | 0.00% | – |
| walk-forward chosen (3 folds OOS) | 274 | 10.2% | 1.32% | -1.24% | -0.98% | 0.12 | 13.43% | -0.76 |
| walk-forward joint (3 folds OOS) | 105 | 15.2% | 2.32% | -1.31% | -0.76% | 0.32 | 4.13% | -0.37 |

Walk-forward picks: fold 1: icBase@0.25; fold 1 joint: icAll@0.275 hold30_sl10_tp25; fold 2: icBase@0.8; fold 2 joint: icBase@0.425 hold120_sl10_tp25; fold 3: icBase@0.8; fold 3 joint: icBase@0.425 hold60_sl10_tp25

Ranking quality, threshold-free (TEST decisions; mean net return of the top q% by each score):

| scorer | top 2% | top 5% | top 10% | top 25% | all |
|---|---|---|---|---|---|
| live | 0.50% (win 42%, n=31) | -0.87% (win 26%, n=77) | -1.40% (win 19%, n=155) | -1.32% (win 16%, n=387) | -1.58% (win 15%, n=1546) |
| defaults | 0.50% (win 48%, n=31) | -1.01% (win 25%, n=77) | -1.47% (win 19%, n=155) | -1.43% (win 15%, n=387) | -1.58% (win 15%, n=1546) |
| icBase | -0.90% (win 0%, n=31) | -0.95% (win 1%, n=77) | -0.92% (win 1%, n=155) | -0.87% (win 2%, n=387) | -1.58% (win 15%, n=1546) |
| icAll | -1.10% (win 3%, n=31) | -0.97% (win 1%, n=77) | -0.92% (win 1%, n=155) | -0.87% (win 2%, n=387) | -1.58% (win 15%, n=1546) |
| icShippable | -1.10% (win 3%, n=31) | -0.97% (win 1%, n=77) | -0.92% (win 1%, n=155) | -0.87% (win 2%, n=387) | -1.58% (win 15%, n=1546) |

Each scorer at the live threshold 0.75 (TEST portfolio): live: n=0, exp –%; defaults: n=0, exp –%; icBase: n=194, exp -0.93%; icAll: n=10, exp -1.12%; icShippable: n=10, exp -1.12%

Live weights, threshold sweep (train | test):

| threshold | train n | train exp | test n | test hit | test exp |
|---|---|---|---|---|---|
| 0.3 | 42 | -1.42% | 80 | 22.5% | -1.28% |
| 0.4 | 13 | -2.14% | 13 | 61.5% | 2.15% |
| 0.5 | 0 | –% | 5 | 40.0% | -0.39% |
| 0.55 | 0 | –% | 2 | 50.0% | 2.70% |
| 0.6 | 0 | –% | 0 | – | –% |
| 0.65 | 0 | –% | 0 | – | –% |
| 0.7 | 0 | –% | 0 | – | –% |
| 0.75 | 0 | –% | 0 | – | –% |

Information coefficient (Spearman of signal vs net trade return; and vs raw 60-min forward return):

| signal | IC train | IC test | IC60 train | IC60 test |
|---|---|---|---|---|
| volumeSpike | -0.039 | -0.019 | -0.008 | -0.008 |
| momentum | -0.127 | -0.120 | -0.085 | -0.047 |
| breakout | -0.135 | -0.093 | -0.050 | -0.039 |
| velocitySurge | 0.028 | 0.060 | 0.034 | 0.012 |
| microCapHeat | -0.137 | -0.073 | -0.050 | -0.011 |
| nanoCapSpike | – | – | – | – |
| liquidityBuild | 0.121 | 0.270 | 0.157 | 0.035 |
| volMcapRatio | -0.082 | -0.041 | -0.090 | 0.154 |
| volumePersistence | 0.034 | 0.037 | 0.040 | -0.068 |
| trendAlignment | -0.049 | 0.017 | -0.059 | -0.074 |
| freshness | -0.070 | -0.172 | -0.058 | 0.049 |
| dipInUptrend | 0.026 | -0.075 | -0.013 | -0.013 |
| higherLows | -0.017 | -0.030 | -0.102 | -0.057 |
| liveComposite | -0.096 | 0.037 | -0.035 | 0.002 |

Calibration (live score; isotonic fit on train). Test Brier 0.1279 vs base-rate 0.1294 (lower is better). Train win rate 17.5%.

| score bucket | test n | test win rate (95% CI) | test mean net |
|---|---|---|---|
| 0–0.2 | 1224 | 15.7% (14%–18%) | -1.63% |
| 0.2–0.3 | 229 | 9.2% (6%–14%) | -1.50% |
| 0.3–0.4 | 76 | 15.8% (9%–26%) | -1.72% |
| 0.4–0.5 | 11 | 63.6% (35%–85%) | 1.81% |
| 0.5–0.6 | 6 | 50.0% (19%–81%) | 1.31% |
| 0.6–0.7 | 0 | – (–––) | –% |
| 0.7–0.8 | 0 | – (–––) | –% |
| 0.8–1 | 0 | – (–––) | –% |

Calibration (chosen score; isotonic fit on train). Test Brier 0.1485 vs base-rate 0.1294 (lower is better). Train win rate 17.5%.

| score bucket | test n | test win rate (95% CI) | test mean net |
|---|---|---|---|
| 0–0.2 | 848 | 19.2% (17%–22%) | -2.00% |
| 0.2–0.3 | 268 | 20.1% (16%–25%) | -1.38% |
| 0.3–0.4 | 32 | 25.0% (13%–42%) | -0.50% |
| 0.4–0.5 | 11 | 9.1% (2%–38%) | -2.20% |
| 0.5–0.6 | 1 | 100.0% (21%–100%) | 1.75% |
| 0.6–0.7 | 0 | – (–––) | –% |
| 0.7–0.8 | 274 | 2.2% (1%–5%) | -0.85% |
| 0.8–1 | 112 | 1.8% (0%–6%) | -0.93% |

Exit sensitivity (chosen score; ranked on train; current hold6_sl5_tp15):

| exits | train n | train exp | test n | test hit | test exp | test PF |
|---|---|---|---|---|---|---|
| hold6_sl5_tp15 | 50 | -0.74% | 73 | 2.7% | -0.91% | 0.01 |
| hold6_sl5_tp25 | 50 | -0.74% | 73 | 2.7% | -0.91% | 0.01 |
| hold6_sl10_tp15 | 50 | -0.74% | 73 | 2.7% | -0.91% | 0.01 |
| hold6_sl10_tp25 | 50 | -0.74% | 73 | 2.7% | -0.91% | 0.01 |
| hold30_sl5_tp15 | 27 | -0.72% | 35 | 8.6% | -0.93% | 0.07 |
| hold30_sl5_tp25 | 27 | -0.72% | 35 | 8.6% | -0.93% | 0.07 |

Top filter rejections: mcap outside $X (27849); Nh volume < N% of mcap (12155); Nh move > N% (34); pool liquidity < $X (24); younger than Nh (2)
