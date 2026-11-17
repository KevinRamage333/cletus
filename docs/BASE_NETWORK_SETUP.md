# Base market-data adapter — clean rebuild (v2)

## What this module does
- Reads DexScreener's latest token profile and boost feeds.
- Keeps only Base-chain entries with valid 20-byte EVM addresses.
- Fetches pair data in batches of no more than 30 token addresses.
- Normalizes numeric fields without turning absent prices into zero.
- Filters pair orientation correctly: DexScreener's `priceUsd` is the base-token price, so a requested token found only on the quote side is not reported as that token's USD price.
- Selects only priced, positive-liquidity markets; liquidity ranks first and 24-hour volume breaks ties.
- Uses a 10-second request timeout, 30-second successful-response cache and bounded cache size.
- Uses best-effort discovery feeds and fails only when all discovery sources fail.

## Explicit safety boundary
This remains read-only discovery. It does not quote swaps, estimate total Base fees, create simulated fills, persist positions, sign transactions, or broadcast. Base paper trading and execution remain disabled. Do not enable them until the separate quote/fee/fill/accounting path is tested end-to-end.

## Why v2 replaces the original
The original PR #3 accepted arbitrary non-empty address strings, could convert a missing price into zero, trusted any URL, and selected a pair with a blended liquidity/volume score that could prefer a shallow pool. Those are data-integrity defects. The rewrite validates inputs at the boundary and uses explicit market-quality rules.

## Entry points retained for compatibility
- `parseBaseTokenIdentities`
- `parseBasePairs`
- `filterBasePairsForTokens`
- `discoverBaseTokens`
- `fetchBasePairsForTokens`
- `bestBasePairPerToken`
- `fetchBaseMarketSnapshot`

The shared Brain's `get_base_market_candidates` tool continues to call the same public snapshot function.
