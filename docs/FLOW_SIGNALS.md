# Whale flow and X hype signals

Both feeds act only as **confirmers or vetoes** on candidates that the normal scorer already likes. Neither one can open a trade by itself.

## Whale / smart-money / dev flow (Helius)
- Source: Helius Parsed Events transaction history per pool (`src/lib/flow-collector.ts`, pure logic in `src/lib/whales.ts`). No solscan.com scraping. The Solscan Pro API is not used (no key); Solscan links are display only.
- Cadence: held positions every 120 s, top candidates every 600 s, up to `WHALE_MAX_POOLS=6` pools per pass. Fresh-wallet checks use `getSignaturesForAddress` (1 credit, up to 8 per burst). A top-10 holder snapshot (DAS) runs every 30 min for held positions. Smart-money discovery runs every 30 ticks.
- Budget: `HELIUS_FLOW_CREDITS_PER_DAY` (default 10,000, which is about 300k/month, or 30% of the free 1M plan). The collector stops for the day when the bucket is empty. The smoke test used 43 credits for 4 pools.
- Watched wallets:
  - auto smart money;
  - dev (RugCheck creator);
  - manual: `WATCHED_WALLETS=addr[:kind[:mint]],...` or `npx tsx --env-file=.env.local scripts/whales/add-wallet.ts <addr> --kind manual [--mint M] [--remove]`.
- Controls:
  - `SIGNAL_VETO_MODE=off|shadow|on` (default shadow: log the verdict, don't block);
  - `WHALE_FAST_EXIT=true|false` (default true: a dev or whale exit closes the position);
  - `WHALE_MIN_USD` (default 1000).
- One-off pass: `npx tsx --env-file=.env.local scripts/whales/collect-once.ts --pools 4`.

## X hype (official X API v2 only)
- Needs `X_BEARER_TOKEN` (the owner must create one in the X developer portal; none is configured). Without it, everything reports `no_data` and nothing breaks.
- Never scrapes x.com.
- Budget: `X_MAX_REQUESTS_PER_DAY=300`, `X_PER_TOKEN_INTERVAL_MIN=15`, `X_TOKENS_PER_TICK=2`, `X_SEARCH_SAMPLE=50`.

## Backtest
`scripts/backtest/run.ts` reports how much flow and X history is stored. It evaluates the features (IC, mean net return of vetoed vs kept decisions, computed only from swaps before each decision) once there are ≥ 72 h on ≥ 20 backtest tokens and ≥ 200 covered decisions. As of 2026-11-11 there is about 1 h of whale data and no X data, so they are **not evaluable yet**.
