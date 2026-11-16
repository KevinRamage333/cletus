# Base read-only market-data adapter

## Included
- Discovers Base token addresses from DexScreener profile and boost feeds (chainId: base).
- Fetches Base pair snapshots in batches of at most 30 addresses.
- Normalizes USD price, 24-hour volume, liquidity, FDV/market cap, price change, pair age, DEX and pair URL.
- Selects the deepest/most active pair per token; caches successful responses for 30 seconds.
- Filters all discovery and pair results by Base chain identity.
- Exposes an on-demand `get_base_market_candidates` tool to the existing shared Cletus Brain; the tool is read-only and only runs when requested.

## Pair orientation
DexScreener may return a pool where the requested token is the quote asset. The current snapshot only accepts pools where the requested token is the base asset, because the returned `priceUsd` belongs to the base token. Quote-side candidates are omitted until their USD price can be calculated correctly. This prevents assigning another token's price to the requested asset.

## Safety boundary
This is discovery and market data only. It does not fetch executable swap quotes, estimate Base gas, model failed transactions, create paper fills, persist positions, sign transactions, or broadcast transactions. Base remains `adapterReady: false` and `paperTradingEnabled: false` in the network registry. Do not change those flags until quote/fill modeling, gas and slippage assumptions, chain-scoped persistence, and paper-only end-to-end tests are complete.

## Provider
DexScreener public API; no API key is required by this adapter. Requests use a 10-second timeout and a short in-process cache. Provider rate limits and terms still apply; avoid high-frequency polling and add a shared limiter before production scheduling.

## Entry points
- `discoverBaseTokens()`
- `fetchBasePairsForTokens(addresses)`
- `fetchBaseMarketSnapshot(limit)`
- Brain tool: `get_base_market_candidates`
- Pure parsers/ranker are covered by `tests/base-market-data.test.ts`.

## Not yet connected
The automated Solana engine, its entry/audit/exit path, and portfolio remain unchanged. Base is not automatically scanned or traded; the shared Brain can fetch Base snapshots on demand and discuss them with the user.
