# Cletus backtest report

Generated 2026-11-11T17:17:09.289Z · dataset d6c54ef5b488 · 60 pools · 46,789 five-minute candles · 2026-10-29T13:15:00.000Z → 2026-11-11T17:15:00.000Z (UTC) · clip $25

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
| chosen (icAll @ 0.3) train | 18 | 61.1% | 6.15% | -2.89% | 2.63% | 3.34 | 0.02% | 0.44 |
| chosen TEST | 129 | 33.3% | 5.02% | -5.10% | -1.72% | 0.49 | 0.56% | -0.30 |
| chosen TEST (customer fee) | 129 | 31.0% | 4.82% | -5.39% | -2.22% | 0.40 | 0.72% | -0.39 |
| joint score+exits (icAll @ 0.275, hold60_sl10_tp15) train | 24 | 79.2% | 7.84% | -1.44% | 5.91% | 20.74 | 0.01% | 0.90 |
| joint TEST | 133 | 33.1% | 7.49% | -8.51% | -3.22% | 0.44 | 1.07% | -0.35 |
| joint TEST (customer fee) | 133 | 30.1% | 7.69% | -8.66% | -3.74% | 0.38 | 1.25% | -0.41 |
| walk-forward baseline (3 folds OOS) | 0 | – | –% | –% | –% | – | 0.00% | – |
| walk-forward chosen (3 folds OOS) | 159 | 37.7% | 4.57% | -4.91% | -1.33% | 0.56 | 0.57% | -0.23 |
| walk-forward joint (3 folds OOS) | 202 | 36.1% | 7.91% | -8.16% | -2.35% | 0.55 | 1.24% | -0.25 |

Walk-forward picks: fold 1: icBase@0.325; fold 1 joint: icAll@0.25 hold60_sl10_tp15; fold 2: icBase@0.35; fold 2 joint: icAll@0.3 hold30_sl10_tp15; fold 3: icBase@0.35; fold 3 joint: icBase@0.2 hold30_sl10_tp25

Ranking quality, threshold-free (TEST decisions; mean net return of the top q% by each score):

| scorer | top 2% | top 5% | top 10% | top 25% | all |
|---|---|---|---|---|---|
| live | -1.66% (win 39%, n=23) | -1.75% (win 36%, n=56) | -2.12% (win 28%, n=113) | -2.10% (win 25%, n=282) | -1.44% (win 28%, n=1127) |
| defaults | -1.81% (win 39%, n=23) | -1.77% (win 34%, n=56) | -2.14% (win 29%, n=113) | -2.03% (win 26%, n=282) | -1.44% (win 28%, n=1127) |
| icBase | -4.30% (win 17%, n=23) | -1.85% (win 34%, n=56) | -1.80% (win 35%, n=113) | -1.67% (win 30%, n=282) | -1.44% (win 28%, n=1127) |
| icAll | -3.47% (win 22%, n=23) | -2.16% (win 34%, n=56) | -1.91% (win 32%, n=113) | -1.78% (win 30%, n=282) | -1.44% (win 28%, n=1127) |
| icShippable | -3.47% (win 22%, n=23) | -2.16% (win 34%, n=56) | -1.91% (win 32%, n=113) | -1.78% (win 30%, n=282) | -1.44% (win 28%, n=1127) |

Each scorer at the live threshold 0.75 (TEST portfolio): live: n=0, exp –%; defaults: n=0, exp –%; icBase: n=4, exp -4.52%; icAll: n=0, exp –%; icShippable: n=0, exp –%

Live weights, threshold sweep (train | test):

| threshold | train n | train exp | test n | test hit | test exp |
|---|---|---|---|---|---|
| 0.3 | 62 | 0.24% | 212 | 25.9% | -1.95% |
| 0.4 | 21 | 0.49% | 92 | 31.5% | -1.88% |
| 0.5 | 8 | 3.28% | 38 | 42.1% | -1.41% |
| 0.55 | 4 | 6.37% | 26 | 42.3% | -1.26% |
| 0.6 | 0 | –% | 11 | 36.4% | -2.62% |
| 0.65 | 0 | –% | 6 | 16.7% | -5.39% |
| 0.7 | 0 | –% | 2 | 50.0% | -2.23% |
| 0.75 | 0 | –% | 0 | – | –% |

Information coefficient (Spearman of signal vs net trade return; and vs raw 60-min forward return):

| signal | IC train | IC test | IC60 train | IC60 test |
|---|---|---|---|---|
| volumeSpike | 0.089 | -0.131 | 0.071 | -0.085 |
| momentum | -0.102 | -0.118 | -0.098 | -0.086 |
| breakout | -0.041 | -0.158 | -0.065 | -0.069 |
| velocitySurge | 0.055 | 0.014 | 0.063 | 0.059 |
| microCapHeat | -0.081 | -0.147 | -0.043 | -0.030 |
| nanoCapSpike | – | – | – | – |
| liquidityBuild | 0.010 | 0.133 | 0.032 | 0.104 |
| volMcapRatio | 0.045 | -0.133 | 0.093 | -0.154 |
| volumePersistence | 0.037 | -0.005 | 0.035 | -0.006 |
| trendAlignment | -0.090 | -0.112 | -0.087 | -0.126 |
| freshness | 0.001 | 0.011 | 0.033 | 0.088 |
| dipInUptrend | 0.026 | -0.031 | -0.005 | -0.100 |
| higherLows | -0.133 | 0.010 | -0.067 | 0.023 |
| liveComposite | -0.037 | -0.183 | -0.001 | -0.120 |

Calibration (live score; isotonic fit on train). Test Brier 0.2124 vs base-rate 0.2013 (lower is better). Train win rate 29.6%.

| score bucket | test n | test win rate (95% CI) | test mean net |
|---|---|---|---|
| 0–0.2 | 567 | 31.4% (28%–35%) | -0.95% |
| 0.2–0.3 | 309 | 23.9% (20%–29%) | -1.81% |
| 0.3–0.4 | 144 | 21.5% (16%–29%) | -2.08% |
| 0.4–0.5 | 64 | 21.9% (14%–33%) | -2.40% |
| 0.5–0.6 | 32 | 40.6% (26%–58%) | -1.18% |
| 0.6–0.7 | 9 | 33.3% (12%–65%) | -2.71% |
| 0.7–0.8 | 2 | 50.0% (9%–91%) | -2.23% |
| 0.8–1 | 0 | – (–––) | –% |

Calibration (chosen score; isotonic fit on train). Test Brier 0.2144 vs base-rate 0.2013 (lower is better). Train win rate 29.6%.

| score bucket | test n | test win rate (95% CI) | test mean net |
|---|---|---|---|
| 0–0.2 | 834 | 26.7% (24%–30%) | -1.37% |
| 0.2–0.3 | 160 | 30.0% (23%–38%) | -1.42% |
| 0.3–0.4 | 76 | 31.6% (22%–43%) | -1.63% |
| 0.4–0.5 | 29 | 41.4% (26%–59%) | -1.60% |
| 0.5–0.6 | 17 | 29.4% (13%–53%) | -2.53% |
| 0.6–0.7 | 10 | 20.0% (6%–51%) | -3.43% |
| 0.7–0.8 | 1 | 0.0% (0%–79%) | -1.95% |
| 0.8–1 | 0 | – (–––) | –% |

Exit sensitivity (chosen score; ranked on train; current hold6_sl5_tp15):

| exits | train n | train exp | test n | test hit | test exp | test PF |
|---|---|---|---|---|---|---|
| hold30_sl10_tp15 | 17 | 5.74% | 118 | 35.6% | -3.19% | 0.45 |
| hold60_sl10_tp15 | 17 | 5.58% | 118 | 34.7% | -3.03% | 0.47 |
| hold120_sl10_tp15 | 17 | 5.58% | 118 | 34.7% | -3.03% | 0.46 |
| hold30_sl10_tp25 | 16 | 5.65% | 118 | 35.6% | -2.99% | 0.49 |
| hold15_sl10_tp15 | 17 | 4.76% | 121 | 36.4% | -2.82% | 0.45 |
| hold60_sl10_tp25 | 16 | 5.19% | 118 | 34.7% | -2.79% | 0.51 |

Top filter rejections: mcap outside $X (35498); pool liquidity < $X (5079); Nh volume < N% of mcap (316); Nh volume < $X (143); Nh move > N% (44); younger than Nh (2)

## Balanced $250k-$5M

Snapshots 42,943 · eligible after filters 8,207 (28 pools)

Split: train 2026-11-08T02:40:00.000Z → 2026-11-10T06:37:00.000Z, test → 2026-11-11T17:15:00.000Z

| | trades | hit rate | avg win | avg loss | expectancy | profit factor | max DD | Sharpe/trade |
|---|---|---|---|---|---|---|---|---|
| baseline (live weights @ 0.75) train | 0 | – | –% | –% | –% | – | 0.00% | – |
| baseline TEST | 0 | – | –% | –% | –% | – | 0.00% | – |
| baseline TEST (customer fee) | 0 | – | –% | –% | –% | – | 0.00% | – |
| chosen (icAll @ 0.675) train | 21 | 47.6% | 4.13% | -1.71% | 1.07% | 2.20 | 0.02% | 0.25 |
| chosen TEST | 54 | 18.5% | 4.81% | -1.78% | -0.56% | 0.62 | 0.09% | -0.15 |
| chosen TEST (customer fee) | 54 | 14.8% | 5.20% | -2.42% | -1.30% | 0.37 | 0.17% | -0.34 |
| joint score+exits (icAll @ 0.675, hold30_sl5_tp15) train | 17 | 52.9% | 5.27% | -1.52% | 2.07% | 3.89 | 0.01% | 0.39 |
| joint TEST | 44 | 22.7% | 8.09% | -3.39% | -0.78% | 0.70 | 0.12% | -0.13 |
| joint TEST (customer fee) | 44 | 20.5% | 8.31% | -4.03% | -1.50% | 0.53 | 0.18% | -0.25 |
| walk-forward baseline (3 folds OOS) | 0 | – | –% | –% | –% | – | 0.00% | – |
| walk-forward chosen (3 folds OOS) | 72 | 20.8% | 4.26% | -1.81% | -0.55% | 0.62 | 0.10% | -0.15 |
| walk-forward joint (3 folds OOS) | 63 | 22.2% | 4.89% | -3.11% | -1.34% | 0.45 | 0.23% | -0.28 |

Walk-forward picks: fold 1: icAll@0.65; fold 1 joint: icAll@0.625 hold15_sl10_tp15; fold 2: icAll@0.675; fold 2 joint: icAll@0.675 hold30_sl5_tp15; fold 3: icAll@0.675; fold 3 joint: icAll@0.7 hold30_sl5_tp25

Ranking quality, threshold-free (TEST decisions; mean net return of the top q% by each score):

| scorer | top 2% | top 5% | top 10% | top 25% | all |
|---|---|---|---|---|---|
| live | -1.44% (win 32%, n=105) | -1.49% (win 28%, n=262) | -1.47% (win 24%, n=524) | -1.48% (win 22%, n=1309) | -1.19% (win 23%, n=5235) |
| defaults | -1.60% (win 30%, n=105) | -1.52% (win 28%, n=262) | -1.53% (win 24%, n=524) | -1.51% (win 21%, n=1309) | -1.19% (win 23%, n=5235) |
| icBase | -0.61% (win 20%, n=105) | -0.73% (win 23%, n=262) | -0.84% (win 20%, n=524) | -0.91% (win 17%, n=1309) | -1.19% (win 23%, n=5235) |
| icAll | -0.72% (win 24%, n=105) | -0.77% (win 24%, n=262) | -0.94% (win 22%, n=524) | -0.96% (win 17%, n=1309) | -1.19% (win 23%, n=5235) |
| icShippable | -0.72% (win 24%, n=105) | -0.77% (win 24%, n=262) | -0.94% (win 22%, n=524) | -0.96% (win 17%, n=1309) | -1.19% (win 23%, n=5235) |

Each scorer at the live threshold 0.75 (TEST portfolio): live: n=0, exp –%; defaults: n=0, exp –%; icBase: n=114, exp -0.79%; icAll: n=11, exp -0.96%; icShippable: n=11, exp -0.96%

Live weights, threshold sweep (train | test):

| threshold | train n | train exp | test n | test hit | test exp |
|---|---|---|---|---|---|
| 0.3 | 237 | -0.83% | 598 | 23.7% | -1.49% |
| 0.4 | 91 | -0.96% | 240 | 26.7% | -1.53% |
| 0.5 | 28 | -0.32% | 77 | 31.2% | -1.60% |
| 0.55 | 13 | -2.05% | 36 | 36.1% | -1.79% |
| 0.6 | 1 | -6.57% | 15 | 33.3% | -2.06% |
| 0.65 | 0 | –% | 6 | 16.7% | -5.39% |
| 0.7 | 0 | –% | 2 | 50.0% | -2.23% |
| 0.75 | 0 | –% | 0 | – | –% |

Information coefficient (Spearman of signal vs net trade return; and vs raw 60-min forward return):

| signal | IC train | IC test | IC60 train | IC60 test |
|---|---|---|---|---|
| volumeSpike | 0.018 | -0.082 | 0.015 | 0.001 |
| momentum | -0.105 | -0.133 | -0.128 | -0.087 |
| breakout | -0.094 | -0.117 | -0.099 | -0.062 |
| velocitySurge | 0.025 | 0.021 | 0.025 | 0.028 |
| microCapHeat | -0.115 | -0.144 | -0.064 | -0.060 |
| nanoCapSpike | – | – | – | – |
| liquidityBuild | 0.082 | 0.099 | 0.106 | 0.088 |
| volMcapRatio | -0.002 | -0.110 | 0.067 | -0.023 |
| volumePersistence | 0.014 | 0.018 | 0.010 | 0.022 |
| trendAlignment | -0.083 | -0.087 | -0.113 | -0.090 |
| freshness | 0.026 | 0.001 | 0.021 | 0.118 |
| dipInUptrend | 0.026 | -0.049 | 0.007 | -0.068 |
| higherLows | -0.077 | -0.031 | -0.068 | 0.026 |
| liveComposite | -0.084 | -0.144 | -0.049 | -0.040 |

Calibration (live score; isotonic fit on train). Test Brier 0.1903 vs base-rate 0.1765 (lower is better). Train win rate 24.0%.

| score bucket | test n | test win rate (95% CI) | test mean net |
|---|---|---|---|
| 0–0.2 | 3340 | 24.4% (23%–26%) | -1.03% |
| 0.2–0.3 | 1161 | 17.7% (16%–20%) | -1.52% |
| 0.3–0.4 | 454 | 21.4% (18%–25%) | -1.46% |
| 0.4–0.5 | 196 | 26.5% (21%–33%) | -1.33% |
| 0.5–0.6 | 69 | 30.4% (21%–42%) | -1.52% |
| 0.6–0.7 | 13 | 30.8% (13%–58%) | -2.03% |
| 0.7–0.8 | 2 | 50.0% (9%–91%) | -2.23% |
| 0.8–1 | 0 | – (–––) | –% |

Calibration (chosen score; isotonic fit on train). Test Brier 0.1783 vs base-rate 0.1765 (lower is better). Train win rate 24.0%.

| score bucket | test n | test win rate (95% CI) | test mean net |
|---|---|---|---|
| 0–0.2 | 60 | 20.0% (12%–32%) | -2.20% |
| 0.2–0.3 | 774 | 24.7% (22%–28%) | -1.21% |
| 0.3–0.4 | 1642 | 23.4% (21%–26%) | -1.37% |
| 0.4–0.5 | 1637 | 24.5% (22%–27%) | -1.13% |
| 0.5–0.6 | 909 | 17.7% (15%–20%) | -1.02% |
| 0.6–0.7 | 176 | 22.7% (17%–29%) | -0.73% |
| 0.7–0.8 | 35 | 20.0% (10%–36%) | -1.04% |
| 0.8–1 | 2 | 0.0% (0%–66%) | -0.22% |

Exit sensitivity (chosen score; ranked on train; current hold6_sl5_tp15):

| exits | train n | train exp | test n | test hit | test exp | test PF |
|---|---|---|---|---|---|---|
| hold30_sl5_tp15 | 17 | 2.07% | 44 | 22.7% | -0.78% | 0.70 |
| hold30_sl10_tp15 | 17 | 2.07% | 43 | 27.9% | -0.17% | 0.93 |
| hold60_sl5_tp15 | 16 | 2.10% | 42 | 23.8% | -0.81% | 0.70 |
| hold60_sl10_tp15 | 16 | 2.10% | 41 | 29.3% | -0.24% | 0.91 |
| hold15_sl5_tp15 | 20 | 1.71% | 51 | 19.6% | -0.89% | 0.58 |
| hold15_sl10_tp15 | 20 | 1.71% | 51 | 21.6% | -0.59% | 0.72 |

Top filter rejections: mcap outside $X (25258); Nh volume < N% of mcap (7849); pool liquidity < $X (1479); Nh move > N% (136); younger than Nh (7); Nh volume < $X (7)

## Safer $5M-$50M

Snapshots 42,943 · eligible after filters 2,879 (10 pools)

Split: train 2026-11-08T08:00:00.000Z → 2026-11-10T08:45:00.000Z, test → 2026-11-11T17:15:00.000Z

| | trades | hit rate | avg win | avg loss | expectancy | profit factor | max DD | Sharpe/trade |
|---|---|---|---|---|---|---|---|---|
| baseline (live weights @ 0.75) train | 0 | – | –% | –% | –% | – | 0.00% | – |
| baseline TEST | 0 | – | –% | –% | –% | – | 0.00% | – |
| baseline TEST (customer fee) | 0 | – | –% | –% | –% | – | 0.00% | – |
| chosen (icAll @ 0.275) train | 161 | 12.4% | 2.14% | -1.08% | -0.68% | 0.28 | 0.30% | -0.44 |
| chosen TEST | 217 | 6.9% | 2.30% | -1.09% | -0.86% | 0.16 | 0.47% | -0.61 |
| chosen TEST (customer fee) | 217 | 4.1% | 3.16% | -1.85% | -1.64% | 0.07 | 0.89% | -1.14 |
| joint score+exits (icBase @ 0.4, hold120_sl10_tp15) train | 55 | 32.7% | 4.53% | -1.61% | 0.40% | 1.37 | 0.06% | 0.09 |
| joint TEST | 54 | 22.2% | 0.93% | -1.70% | -1.11% | 0.16 | 0.15% | -0.45 |
| joint TEST (customer fee) | 54 | 3.7% | 3.62% | -2.12% | -1.91% | 0.07 | 0.26% | -0.78 |
| walk-forward baseline (3 folds OOS) | 0 | – | –% | –% | –% | – | 0.00% | – |
| walk-forward chosen (3 folds OOS) | 472 | 12.9% | 1.58% | -1.23% | -0.87% | 0.19 | 1.03% | -0.60 |
| walk-forward joint (3 folds OOS) | 136 | 16.9% | 1.82% | -1.18% | -0.67% | 0.31 | 0.23% | -0.38 |

Walk-forward picks: fold 1: icBase@0.2; fold 1 joint: icAll@0.25 hold15_sl10_tp25; fold 2: icBase@0.8; fold 2 joint: icBase@0.425 hold120_sl10_tp25; fold 3: icAll@0.275; fold 3 joint: icBase@0.425 hold60_sl10_tp25

Ranking quality, threshold-free (TEST decisions; mean net return of the top q% by each score):

| scorer | top 2% | top 5% | top 10% | top 25% | all |
|---|---|---|---|---|---|
| live | 1.23% (win 45%, n=31) | -0.42% (win 27%, n=77) | -0.96% (win 23%, n=155) | -0.91% (win 18%, n=387) | -1.06% (win 22%, n=1546) |
| defaults | 1.29% (win 52%, n=31) | -0.49% (win 27%, n=77) | -1.00% (win 23%, n=155) | -1.00% (win 19%, n=387) | -1.06% (win 22%, n=1546) |
| icBase | -0.91% (win 0%, n=31) | -0.95% (win 1%, n=77) | -0.92% (win 1%, n=155) | -0.87% (win 2%, n=387) | -1.06% (win 22%, n=1546) |
| icAll | -1.11% (win 3%, n=31) | -0.97% (win 1%, n=77) | -0.94% (win 2%, n=155) | -0.89% (win 2%, n=387) | -1.06% (win 22%, n=1546) |
| icShippable | -1.11% (win 3%, n=31) | -0.97% (win 1%, n=77) | -0.94% (win 2%, n=155) | -0.89% (win 2%, n=387) | -1.06% (win 22%, n=1546) |

Each scorer at the live threshold 0.75 (TEST portfolio): live: n=0, exp –%; defaults: n=0, exp –%; icBase: n=194, exp -0.93%; icAll: n=4, exp -1.23%; icShippable: n=4, exp -1.23%

Live weights, threshold sweep (train | test):

| threshold | train n | train exp | test n | test hit | test exp |
|---|---|---|---|---|---|
| 0.3 | 42 | -1.27% | 80 | 25.0% | -0.86% |
| 0.4 | 13 | -1.94% | 13 | 61.5% | 2.72% |
| 0.5 | 0 | –% | 5 | 40.0% | 0.01% |
| 0.55 | 0 | –% | 2 | 50.0% | 3.09% |
| 0.6 | 0 | –% | 0 | – | –% |
| 0.65 | 0 | –% | 0 | – | –% |
| 0.7 | 0 | –% | 0 | – | –% |
| 0.75 | 0 | –% | 0 | – | –% |

Information coefficient (Spearman of signal vs net trade return; and vs raw 60-min forward return):

| signal | IC train | IC test | IC60 train | IC60 test |
|---|---|---|---|---|
| volumeSpike | -0.020 | -0.021 | -0.008 | -0.008 |
| momentum | -0.122 | -0.075 | -0.085 | -0.047 |
| breakout | -0.140 | -0.073 | -0.050 | -0.039 |
| velocitySurge | 0.021 | 0.055 | 0.034 | 0.012 |
| microCapHeat | -0.148 | -0.073 | -0.050 | -0.011 |
| nanoCapSpike | – | – | – | – |
| liquidityBuild | 0.082 | 0.092 | 0.157 | 0.035 |
| volMcapRatio | -0.031 | -0.047 | -0.090 | 0.154 |
| volumePersistence | 0.026 | 0.012 | 0.040 | -0.068 |
| trendAlignment | -0.104 | -0.053 | -0.059 | -0.074 |
| freshness | -0.016 | -0.024 | -0.058 | 0.049 |
| dipInUptrend | 0.031 | -0.014 | -0.013 | -0.013 |
| higherLows | -0.025 | -0.042 | -0.102 | -0.057 |
| liveComposite | -0.128 | -0.033 | -0.035 | 0.002 |

Calibration (live score; isotonic fit on train). Test Brier 0.1819 vs base-rate 0.1710 (lower is better). Train win rate 20.7%.

| score bucket | test n | test win rate (95% CI) | test mean net |
|---|---|---|---|
| 0–0.2 | 1224 | 23.4% (21%–26%) | -1.07% |
| 0.2–0.3 | 229 | 11.8% (8%–17%) | -1.15% |
| 0.3–0.4 | 76 | 18.4% (11%–29%) | -1.33% |
| 0.4–0.5 | 11 | 63.6% (35%–85%) | 2.42% |
| 0.5–0.6 | 6 | 50.0% (19%–81%) | 1.70% |
| 0.6–0.7 | 0 | – (–––) | –% |
| 0.7–0.8 | 0 | – (–––) | –% |
| 0.8–1 | 0 | – (–––) | –% |

Calibration (chosen score; isotonic fit on train). Test Brier 0.1775 vs base-rate 0.1710 (lower is better). Train win rate 20.7%.

| score bucket | test n | test win rate (95% CI) | test mean net |
|---|---|---|---|
| 0–0.2 | 1087 | 28.2% (26%–31%) | -1.12% |
| 0.2–0.3 | 56 | 28.6% (18%–41%) | -1.08% |
| 0.3–0.4 | 12 | 58.3% (32%–81%) | -0.35% |
| 0.4–0.5 | 280 | 2.9% (1%–6%) | -0.85% |
| 0.5–0.6 | 60 | 0.0% (-0%–6%) | -1.01% |
| 0.6–0.7 | 40 | 2.5% (0%–13%) | -0.97% |
| 0.7–0.8 | 11 | 0.0% (0%–26%) | -1.15% |
| 0.8–1 | 0 | – (–––) | –% |

Exit sensitivity (chosen score; ranked on train; current hold6_sl5_tp15):

| exits | train n | train exp | test n | test hit | test exp | test PF |
|---|---|---|---|---|---|---|
| hold120_sl10_tp15 | 56 | 0.34% | 60 | 28.3% | -0.84% | 0.50 |
| hold30_sl10_tp25 | 73 | -0.06% | 82 | 22.0% | -0.58% | 0.55 |
| hold60_sl10_tp15 | 58 | 0.22% | 60 | 30.0% | -0.54% | 0.65 |
| hold60_sl10_tp25 | 58 | 0.12% | 60 | 30.0% | -0.67% | 0.57 |
| hold120_sl10_tp25 | 56 | 0.14% | 60 | 28.3% | -0.97% | 0.43 |
| hold30_sl10_tp15 | 73 | -0.05% | 82 | 22.0% | -0.48% | 0.62 |

Top filter rejections: mcap outside $X (27849); Nh volume < N% of mcap (12155); Nh move > N% (34); pool liquidity < $X (24); younger than Nh (2)
