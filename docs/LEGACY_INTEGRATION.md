# Legacy Cletus integration map

This file records how the original Cletus projects are being carried forward. It is a migration map, not a claim that every legacy feature has already been ported or validated.

## What is already present in the current application

- **Eight original pattern signals:** the current `src/lib/signals.ts` computes volume spike, momentum, breakout, velocity surge, micro-cap heat, nano-cap spike, liquidity build, and volume/market-cap ratio. The current project also has liquidity-focused scoring, fee penalties, and bounded weight updates.
- **AI Brain:** `src/lib/brain/` contains the persona, topic curriculum, Gemini integration, conversation handling, and claims filtering. The brain is advisory; trade authorization remains in deterministic code.
- **Risk and safety:** current risk controls, audit code, RugCheck integration, trade approvals, kill switch, and paper/simulation paths are retained as the authoritative implementation.
- **Multi-chain groundwork:** `src/lib/multichain.ts` provides chain-scoped asset identities and paper-only adapter contracts.

## What this integration adds

- `src/lib/strategy-profiles.ts` introduces two chain-neutral candidate profiles: `new-token` and `established`.
- Both profiles require measured normalized features, contract-safety evidence, and a positive estimated net edge after round-trip fees, gas, slippage, and a separate risk haircut.
- Invalid or missing measurements fail closed. The module ranks candidates only; it cannot create or execute orders.

## Legacy behavior intentionally not copied blindly

- No automatic widening of slippage.
- No automatic increase in position size based on a short win streak.
- No claim that online signal-weight changes prove a profitable edge.
- No treating a liquidity feed as a complete token security audit.
- No live signing or transaction broadcasting in the shared multi-chain layer.
- No reuse of exposed wallet secrets or API keys from old scripts.

## Remaining integration work

1. Add explicit network identity to persisted positions with a backwards-compatible migration (legacy records must be explicitly classified as Solana only after confirming the table's provenance).
2. Connect network-specific read-only market data to the shared strategy feature contract.
3. Add per-network paper fills that model gas, fees, slippage, and failed transactions.
4. Journal feature snapshots and strategy/profile versions for every simulated entry and exit.
5. Validate chronologically on out-of-sample data, including delisted/failed tokens where historical data is available.
6. Only enable a network's paper adapter after its adapter-specific tests and quote validation pass.

## Safety status

This branch remains a development branch. These additions do not enable live trading, do not establish profitability, and do not establish that the application is production-ready. Existing production behavior and `master` are not changed by this work.
