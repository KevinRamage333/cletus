# Whale flow and X hype (confirmer / veto signals)

Code: `src/lib/whales.ts`, `src/lib/social/x.ts` (pure, tested in `tests/flow.test.ts`) and `src/lib/flow-collector.ts` (collectors, storage, engine and Brain read side).

## On-chain "big money movers" (Helius, not solscan.com)
- **Source:** Helius Parsed Events `transaction-history` on each tracked pool (10 credits per call, up to 100 txs). Each tx yields the fee payer's net token delta and its SOL/stable leg. Solscan is only linked (tx and account URLs). There's no Solscan Pro key, and none is needed.
- **Tracked tokens:** open positions every 5 min and the top scan candidates every 10 min (`WHALE_MAX_POOLS`).
- **Watched wallets** (`market_data.watched_wallets`):
  - **smart:** auto-discovered every ~30 ticks from stored swaps. A wallet qualifies with early buys and realized profit on at least 2 tokens, a win rate of at least 60%, and +$1k or more.
  - **dev:** the RugCheck creator.
  - **manual:** `WATCHED_WALLETS` or `scripts/whales/add-wallet.ts`.
  - **top_holder / insider** kinds exist. Top-holder *concentration change* comes from a DAS snapshot every 30 min for open positions.
- **Features:**
  - whale net flow (whale = max($1k, 0.5% of liquidity))
  - smart-money buys and sells
  - dev selling (and its share of what the dev bought)
  - insider sells
  - fresh-wallet bundle clusters: at least 4 new wallets (fewer than 25 lifetime signatures, 1 credit each) buying similar sizes within 2 min
  - top-10 holder share change
- **Use:**
  - **Veto** (`SIGNAL_VETO_MODE=shadow` logs only; `on` blocks) on a dev dump, 2 or more smart wallets exiting, heavy whale net selling, a fresh-wallet bundle, or a top-10 share jump.
  - **Confirm** on smart-money or whale buying with buy-side flow.
  - **Fast exit** (`WHALE_FAST_EXIT`, on by default) for open positions on a dev dump or a smart-money/whale exit.
- **Budget:** a hard daily cap of `HELIUS_FLOW_CREDITS_PER_DAY` (default 10,000/day ≈ 300k/month, about 30% of the free plan's 1M). Candidates stop at 70% of the cap, so the rest is kept for open positions. One test pass over 4 pools used 43 credits.
  - Each tracked candidate (every 10 min) costs about 1.4k credits/day, so 6 of them would want ~8.6k/day.
  - Each open position (every 5 min) costs about 2.9k credits/day, plus ~0.5k/day of DAS snapshots.
  - So the 10k/day cap fits roughly 4 candidates and 1 position at full rate. Beyond that, polling thins out for the rest of the day.
  - Full coverage (6 candidates, several positions every 2 min) needs the Helius Developer plan (10M credits/month).

## X hype (X API v2, not scraping x.com)
- **Off until `X_BEARER_TOKEN` is set.** None exists in `.env.local` today.
- **Per tracked token every 15 min:**
  - `GET /2/tweets/counts/recent` (minute granularity, last 3 h), stored as 15-minute buckets.
  - When there were at least 5 posts in the last hour, a `search/recent` sample (50 posts) with author fields gives unique authors, follower-weighted reach (Σ log10 followers), bot-like/new-account share, and copy-paste share. Organic ratio = 1 − max(bot share, copy-paste share).
  - Daily cap: `X_MAX_REQUESTS_PER_DAY`.
- **Features:** velocity (posts per hour), acceleration (15m vs prior 45m; 1h vs prior 1h), organic vs shill, and hype-vs-price/flow divergence:
  - `exit_liquidity` / `knife`: rising hype into selling or falling price
  - `shill`: rising hype from bots or copy-paste
  - `confirmed`: rising hype with buys and price up
  - `early_move`: price and buys up before hype
- **Use:** veto on exit_liquidity/knife/shill, confirm on confirmed. Never a buy trigger.
- **Backfill:** X recent search reaches back 7 days, so once a token exists the recent past can be filled in for backtesting.

## Running it
- Starts automatically with the app (`src/instrumentation.ts`) when `MARKET_DATA_DATABASE_URL` is set (`FLOW_COLLECTOR=off` disables).
- One-off pass without the app: `npx tsx --env-file=.env.local scripts/whales/collect-once.ts --pools 4`.
- Add an owner wallet: `npx tsx --env-file=.env.local scripts/whales/add-wallet.ts <addr> [label] --kind manual [--mint M] [--remove]`.

## Brain
- `get_whale_activity`: summary like "2 smart-money wallets bought $8.0k in 30 min; dev wallet hasn't sold in this window; buys are 72% of swap volume", plus big movers with Solscan links.
- `get_social_hype`: e.g. "X mentions 4.0x in 1h (60 posts) but sells dominate: hype is being used as exit liquidity."

## Chart
Whale swaps of at least `WHALE_MIN_USD` show as blue (buy) or pink (sell) circles on the native chart, with a link to the latest one on Solscan.

## Backtest
`scripts/backtest/run.ts` reports a "Whale flow and X hype data" section. It evaluates the veto and IC only once at least 72 h of history exists on at least 20 backtest tokens. Features use swaps strictly before each decision.
