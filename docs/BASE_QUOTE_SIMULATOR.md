# Base quote and paper-fill milestone

## Scope delivered in this phase
- Read-only Base mainnet RPC verification (chain ID 8453).
- Single-hop Uniswap v3 QuoterV2 quotes for native Base USDC <-> one ERC-20 token, across fee tiers 500, 3000 and 10000.
- ERC-20 decimals are read on-chain; quote amounts use integer arithmetic.
- L2 gas estimate from QuoterV2 gas usage with a 25% buffer, converted to USD using a Coinbase ETH/USD spot reference.
- Pure adverse-slippage fill preview. No position is created, no account balance changes, and nothing is persisted.
- Default public RPC is `https://mainnet.base.org`; set `BASE_RPC_URL` to a provider endpoint for higher reliability. Public Base RPC is rate-limited.

## Critical fee limitation
Base transaction costs include both L2 execution and L1 data fees. This phase only estimates L2 execution cost; it does not have exact router calldata and therefore cannot calculate the L1 data fee. The response deliberately returns `l1DataFeeUsd: null` and `feeEstimateComplete: false`. Do not treat the returned cost as total fees or use it as a profitability/entry gate.

## Explicit exclusions
- No live wallet, private key, approvals, router calldata, transaction signing, or broadcast.
- No DB writes, position records, account balance changes, automatic scans, or automatic trading.
- No Aerodrome/other DEX, multi-hop route, or dynamic route discovery.
- Base remains `adapterReady: false` and `paperTradingEnabled: false`.

## Next gates before Base paper trading
1. Obtain exact swap transaction calldata from a trusted router/aggregator without signing or broadcasting.
2. Calculate Base L1 data fee using the official GasPriceOracle for that exact calldata and verify total fees.
3. Independently estimate router gas and compare against QuoterV2 estimate.
4. Add quote freshness, price impact, liquidity, token safety and route validation limits.
5. Add a chain-scoped paper portfolio and isolated integration tests, then run full test/build and staged paper sessions.
6. Only after all gates pass, consider enabling Base paper trading. Live trading remains a separate decision and is not part of this roadmap phase.

## References
- Uniswap v3 Base deployments: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments
- Uniswap QuoterV2 quoting guide: https://developers.uniswap.org/docs/sdks/v3/guides/swapping/quoting
- Base `eth_gasPrice`: https://docs.base.org/base-account/reference/core/provider-rpc-methods/eth_gasPrice
