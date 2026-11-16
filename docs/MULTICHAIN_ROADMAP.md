# Cletus multi-chain expansion plan

## Accepted product scope

- Initial network set: Solana, Ethereum, Base, BNB Chain, Arbitrum One, Polygon PoS, Avalanche C-Chain, and Sui.
- Trading styles: new-token/micro-cap discovery and established-token spot trading.
- One shared Cletus Brain, portfolio view, exposure budget, risk policy, and audit journal.
- Simulation/paper trading only while adapters, data quality, fills, and strategies are developed and validated.
- No automatic bridging, leverage, custody, or live signing in the first expansion.

## Repository audit: starting point

The current repository is a mature but Solana-specific Next.js/TypeScript application. The README and engine show a Solana scanner (DexScreener mint discovery), Solana token audit, Jupiter quote/swap flow, Helius/FluxRPC, Solana-specific mint/pool identity, and a shared Position model whose identity fields are `mint` and `pairAddress` without a network key.

Important constraints found during the audit:

1. The main engine imports Solana-specific discovery, audit, price, quote, and executor modules directly. A multi-chain scanner cannot safely be bolted onto this engine by just adding RPC URLs.
2. Position identity is not chain-qualified. The same token ticker/address text on different networks could collide in portfolio logic unless all keys become network-scoped.
3. The current AI Brain is documented as advisory-only. It reads status, trades, positions, signals, and news; it does not itself own execution. Keep the model as an analyst/research planner, not an unconstrained transaction signer.
4. The existing signal-weight learner amplifies/dampens signals after each trade. That is not proof of a predictive edge and must not be promoted as such without walk-forward, out-of-sample evidence.
5. The checked-in backtest report says no tested entry configuration had positive out-of-sample expectancy after costs on its small ~3.5-day, 60-pool sample. It also notes survivorship bias and missing historical holder/audit data. This is a major go/no-go issue for strategy claims.
6. The README says simulation is the default and live execution has not been tested with funds. Preserve simulation as the only mode during this project.

## Architecture

### 1. Chain-neutral domain

Use a canonical asset identity `{ network, address }`; never use symbol as an identifier. EVM addresses compare case-insensitively; Solana addresses and Sui object/type identifiers remain case-sensitive. Store decimals, token program/type, pool/market identifier, and provider provenance as explicit metadata.

The first code increment adds `src/lib/multichain.ts`: the network registry, chain-scoped asset key, paper quote/fill contracts, and fail-closed quote validation. Planned networks are deliberately marked not adapter-ready and cannot pass paper-trade validation.

### 2. Adapter boundary

Each adapter must implement read-only discovery, normalized market snapshots, quote retrieval, and deterministic paper fills. It must not expose signing or broadcasting to the shared strategy layer. Chain-specific adapters own finality, nonce/blockhash handling, token metadata, pool math, fee estimation, and provider failover.

### 3. Shared decision system

The Brain can explain and compare opportunities. Deterministic strategy services must produce typed candidate scores and reasons. Keep independent strategies for:
- New listings/micro-caps: launch age, liquidity provenance, authority/ownership checks, holder distribution, pool depth, creator history, sellability, concentration and abnormal flow.
- Established assets: multi-timeframe trend/regime, realized volatility, liquidity depth, volume persistence, spread/impact, funding only if derivatives are ever separately approved.

The global ranker compares net expected return after swap fees, gas, price impact, slippage, and conservative fill uncertainty. If the expected edge is not positive after conservative costs or the data is stale/incomplete, do not trade.

### 4. Shared risk

Risk limits apply both per chain and globally: max open positions, max notional, max exposure, max asset/issuer concentration, daily loss, peak-to-trough drawdown, correlated exposure, and a global kill switch. Network congestion or RPC uncertainty fails closed. No bridging or cross-chain atomic-arbitrage assumptions in v1.

### 5. Paper ledger and evaluation

All fills must be explicitly `simulated: true`, include quote source/time, reference price, estimated gas, swap fees, impact, slippage model, and fill assumptions. Track results by network, strategy, market regime, liquidity tier, and token age. Require:
- no look-ahead or survivorship shortcuts;
- chronological train/validation/test and walk-forward splits;
- realistic gas, fee, impact, failed-transaction, and latency assumptions;
- minimum sample size and confidence intervals;
- positive out-of-sample expectancy after costs across more than one market regime;
- paper forward-test before considering any live capability.

## Delivery phases

1. **Foundation (current branch):** registry, chain-scoped identity, adapter contract, paper quote validation, tests, and this roadmap.
2. **EVM paper adapters:** start with Base (lower transaction-cost profile) and Ethereum read-only market data; add BNB, Arbitrum, Polygon, Avalanche one by one. Each adapter gets fixtures and contract tests.
3. **Sui adapter:** separate implementation for Sui object/type identity and its own DEX routing; do not force it through EVM assumptions.
4. **Strategy separation:** new-token and established-token strategies with shared risk and a net-edge ranker. Retain Solana strategy only where its own tests justify it.
5. **Portfolio/dashboard:** network status, per-chain P&L, global exposure, adapter health, and transparent paper fill assumptions.
6. **Validation gate:** multi-regime historical tests plus continuous paper forward-test. Keep all live execution paths disabled until explicitly reviewed and separately authorized.

## First implementation status

- [x] Development branch created from the current master commit.
- [x] Initial network registry and chain-scoped identity.
- [x] Paper-only adapter and quote contracts.
- [x] Fail-closed paper quote validation.
- [x] Unit tests for chain identity, planned-network blocking, valid quotes, cross-chain rejection, and stale quotes.
- [ ] EVM and Sui data adapters.
- [ ] Chain-aware persistence/migration.
- [ ] Multi-chain strategy integration and portfolio dashboard.
- [ ] Full test/build run in a checkout with dependencies and database configuration.

This branch is a safe foundation, not a claim that all eight networks are already trading. A network becomes enabled only after its adapter and paper tests pass.
