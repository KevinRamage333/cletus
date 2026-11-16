# Base read-only market-data adapter

## Included
- Discovers Base token addresses from DexScreener profile and boost feeds (chainId: base).
- Fetches Base pair snapshots in batches of at most 30 addresses.
- Normalizes USD price, 24-hour volume, liquidity, FDV/market cap, price change, pair age, DEX and pair URL.
- Selects the deepest/most active pair per token; caches successful responses for 30 seconds.
- Filters all discovery and pair results by Base chain identity.

## Safety boundary
This is discovery and market data only. It does not fetch executable swap quotes, estimate Base gas, model failed transactions, create paper fills, persist positions, sign transactions, or broadcast transactions. Base remains adapterReady=false and paperTradingEnabled=false in the network registry. Do not change those flags until quote/fill modeling, gas and slippage assumptions, chain-scoped persistence, and paper-only end-to-end tests are complete.

## Provider
DexScreener public API; no API key is required by this adapter. Requests use a 10-second timeout and a short in-process cache. Provider rate limits and terms still apply; avoid high-frequency polling and add a shared limiter before production scheduling.

## Entry points
- discoverBaseTokens()
- fetchBasePairsForTokens(addresses)
- fetchBaseMarketSnapshot(limit)
- Pure parsers/ranker are covered by tests/base-market-data.test.ts.

## Not yet connected
The Solana-specific engine and collector remain unchanged. This adapter is deliberately isolated until a chain-neutral scanner and portfolio integration are reviewed.
