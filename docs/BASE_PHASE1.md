# Base network — phase 1 (rebuilt)

## Completed in this rebuild
- Strict Base-chain token identity parsing (20-byte EVM address validation).
- Strict pair parsing and case-insensitive pair deduplication.
- Explicit base-token pair orientation; quote-side-only matches are excluded.
- Safe numeric normalization; missing, malformed and non-positive prices remain null.
- HTTPS DexScreener-host URL validation.
- Batched pair requests (maximum 30 addresses), 10-second timeout and bounded 30-second successful-response cache.
- Best-effort discovery feed handling and deterministic liquidity-first market selection.
- Focused unit coverage for chain, address, orientation, numeric, URL and ranking behavior.

## Still required before Base paper trading
1. Trusted Base RPC and token metadata/decimals validation.
2. Exact-input DEX quote adapter with correct chain/token/decimal verification.
3. Complete fee model including L2 execution fee and Base L1 data fee, plus slippage, impact, latency and failed-transaction assumptions.
4. Deterministic paper fills and chain-qualified position, approval, journal and portfolio queries.
5. Tests for stale quotes, wrong chain/token, decimals, fee spikes, partial fills and failed transactions.
6. Forward paper testing and out-of-sample strategy validation.

## Safety
Base remains read-only for discovery. This adapter does not create fills, write positions, sign, or broadcast transactions. Base paper trading and execution remain disabled.
