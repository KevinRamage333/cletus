# Cletus multi-chain execution architecture

## Product requirement

Cletus must monitor every enabled network concurrently. Network coverage must not be implemented as a single active-chain selector or a loop that finishes one chain before starting the next.

The trading system already targets a maximum of 20 simultaneous asset positions. The multi-chain design keeps that as a shared portfolio capacity across all enabled networks unless the owner explicitly configures a different limit. A position always records its network and canonical asset identifier.

## Separate layers

1. **Wallet providers** — Phantom, MetaMask, OKX Wallet, Crypto.com Onchain, Base App/Coinbase Wallet, and compatible WalletConnect wallets.
2. **Networks** — Solana, Ethereum, Base, BNB Smart Chain, Polygon, Cronos, and additional chains only after their adapters are tested.
3. **Market-data and DEX adapters** — chain-specific discovery, quotes, simulation, and transaction construction (for example Jupiter on Solana and independently verified DEX routes on EVM chains).
4. **Portfolio and risk coordinator** — one global view of the 20-asset capacity, exposure, balances, gas, slippage, drawdown, and per-chain limits.

A wallet provider may support multiple networks. A network is not a wallet, and a DEX is not a wallet provider.

## Concurrent operation

- Start one isolated scanner/worker per enabled network; schedule workers concurrently.
- Each worker owns its RPC clients, rate limits, retry/backoff, chain health and supported DEX adapters.
- Normalize results into a common asset/signal format while preserving chain ID, token contract/mint, decimals, quote asset, and source timestamps.
- Use a shared portfolio coordinator to reserve/release one of the 20 asset slots atomically. Never allow two workers to exceed the global position cap through a race.
- A slow or unhealthy network must not block healthy networks. Circuit-break only the affected chain adapter.
- Reconcile positions and transactions against the correct chain; never infer a network from a wallet name or token symbol.
- Treat identical symbols on different chains as different assets unless a verified canonical bridge mapping exists.

## Execution and safety

- Monitoring, signal scoring, and paper simulation may run concurrently across all enabled networks.
- Before a live order, independently check wallet/network match, chain health, token identity, quote freshness, gas, slippage, exposure, position cap, kill switch, and approval state.
- A connected wallet or sign-in message never grants trading permission.
- Every live transaction is prepared for the selected chain and presented to the user's wallet for explicit approval. Cletus never receives seed phrases or private keys.
- A failure, timeout, or unsupported route fails closed for that chain/asset; it must not silently fall back to another network.

## Rollout sequence

1. Read-only wallet/provider discovery and network visibility (this PR).
2. Multi-wallet account model plus Solana SIWS and EVM SIWE verification.
3. Per-network market-data workers and shared 20-position coordinator, initially paper-only.
4. Chain-specific DEX quote/simulation adapters and integration tests.
5. Explicitly approved live execution, only after independent safety and reconciliation tests.

## Current scope of PR #17

The UI in this PR is only a read-only EVM wallet discovery and network-switching foundation. It does not yet implement concurrent market scanning, multi-wallet account linking, WalletConnect QR, cross-chain balances, DEX routing, or live execution. Those are separate milestones and must be tested before they are described as supported.
