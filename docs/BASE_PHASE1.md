# Cletus Base network setup — phase 1

## Completed in this branch
- Read-only Base token discovery from DexScreener profile and boost feeds.
- Base-only token identity filtering.
- Batched Base pair lookup (maximum 30 token addresses per request).
- Normalized market snapshot fields and pair selection by liquidity/volume.
- Unit tests for chain filtering, malformed data, numeric normalization and pair selection.

## Still required before Base paper trading
1. A trusted Base RPC/read provider and token metadata/decimals validation.
2. A DEX quote adapter returning exact-input quotes without signing or broadcasting.
3. Conservative Base gas estimation in USD, swap fees, impact, slippage, latency and failed-transaction assumptions.
4. Deterministic paper fills and chain-qualified position/approval/journal queries.
5. Tests for stale quotes, wrong chain, wrong token, decimals, gas spikes, fee accounting and failed fills.
6. Forward paper testing and out-of-sample strategy validation.

Base remains disabled for paper trading. This branch does not alter production configuration or database state.
