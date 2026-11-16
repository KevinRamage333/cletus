# Cletus Token Intelligence: data setup

This document separates features that work with public endpoints from features that need an account or paid quota. Do not paste provider secrets into chat, GitHub source files, or client-side environment variables.

## What works before buying data

- Token market pairs, price, liquidity, volume, and pair discovery: DexScreener public API.
- Token account inspection, mint/freeze authorities, signatures, and largest token accounts: Solana RPC (Helius is preferred; the configured RPC fallback pool may be used).
- Risk report: RugCheck public endpoint, subject to its public rate limits and availability.
- Sell-route feasibility: Jupiter quote/order endpoint only. Cletus does not sign or submit a transaction from the intelligence screen.

Unavailable sources must remain visibly unavailable. A missing response is never interpreted as a clean security result.

## Provider configuration

### Helius (recommended first account to configure)

Set server-side:
- `HELIUS_API_KEY`: Helius API key. Enables enhanced transaction history and the parsed-events whale-flow collector.
- `HELIUS_RPC_URL`: optional explicit RPC URL. If omitted, Cletus derives the Helius RPC URL from `HELIUS_API_KEY`.
- `HELIUS_WS_URL`: optional explicit WebSocket URL. If omitted, Cletus derives it from the Helius key.
- `HELIUS_FLOW_CREDITS_PER_DAY`: daily cap for the flow collector; default is 10,000 credits. Open positions are prioritized and candidate polling is throttled as the budget is consumed.

Helius is the first paid data account to prioritize because the same integration supports wallet/token inspection, enhanced transaction history, holder analysis, and whale/developer-wallet flow. Check current Helius pricing and credit costs in your Helius dashboard before selecting a plan; do not assume the defaults are included in a free tier.

### Market-data database

Set `MARKET_DATA_DATABASE_URL` to the Postgres database used by the existing market-data collectors. The whale-flow collector creates and writes tables in the `market_data` schema. Without this connection, live flow collection is off even if Helius is configured. Keep this URL server-side.

### Optional providers

- `X_BEARER_TOKEN`: X API v2 bearer token for mention counts and recent-post author sampling. Empty means social-hype collection is off.
- `JUPITER_API_KEY`: server-side Jupiter API key where required by the configured Jupiter plan. Quote-only checks may work without it depending on current endpoint policy.
- `RUGCHECK_API_KEY` / `RUGCHECK_API_URL`: optional RugCheck/FluxRPC credentials. The public RugCheck endpoint is the fallback.

## After adding a provider key

1. Add it in the deployment platform's server-side environment settings, not in a `NEXT_PUBLIC_*` variable.
2. Add it to Preview first, then Production after the preview is verified.
3. Redeploy so the server process receives the new environment.
4. Open Token Intelligence and inspect a known mint.
5. Confirm the displayed source list, fetched timestamp, collector status, Helius credit counter, and warnings.
6. Confirm a missing provider still fails visibly and does not silently produce a green security verdict.

## Trading safety

Token Intelligence and wallet-flow endpoints are read-only. Whale and smart-money signals are observations, not buy commands. Existing flow vetoes/confirmers are not proof of profitability. Continue paper trading and out-of-sample validation after data access is enabled; do not enable autonomous live trading solely because a provider key is present.
