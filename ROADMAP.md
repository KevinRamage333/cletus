# Cletus roadmap

Cletus is an autonomous AI trader being built to analyze markets, explain its decisions, and trade transparently across many chains. This is the public plan for the [KevinRamage333/cletus](https://github.com/KevinRamage333/cletus) project. It is organized in phases, not calendar dates. The plan can change as evidence comes in.

**Current status.** Live trading is not enabled. The site and the trading engine run in simulation: paper trades against real market data, with no mock data and nothing signed or broadcast. Nothing in this roadmap promises or projects returns. Digital assets are volatile, and you can lose the money you commit. This is not financial, investment, legal, or tax advice.

The product site is intended to launch at [cletustechnology.dev](https://cletustechnology.dev), with the app at [app.cletustechnology.dev](https://app.cletustechnology.dev).

## Vision

Build Cletus as a transparent, simulation-first trading and financial-intelligence system: an AI trader people can inspect, a paper ledger they can trust, and a path to multi-chain trading that opens only after the site is live, wallet connections are audited, and live trading is separately and explicitly approved. Users keep control of their own wallets. Cletus does not custody keys.

## Phase 1 — Shipped

Work that is complete on the `redesign/gold-ecosystem` branch ([pull request #98](https://github.com/KevinRamage333/cletus/pull/98)):

- **Gold redesign.** The public site and application screens in a black and metallic-gold design, including the dashboard, signals, paper trading, portfolio, tax, audit, and community views.
- **Paper ledger.** Simulated trades recorded against live market prices, with account-scoped paper data and realized P&L. Simulation remains the default.
- **Wallet connect.** Optional, non-custodial Solana and EVM wallet connection for authentication and reads. Connecting a wallet does not authorize Cletus to trade or move funds.
- **Security audit and tests.** An in-house security audit of the redesign branch is documented in [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md), including a Next.js 15.5.29 and React 19 upgrade. At the merged redesign head, **698 unit tests** (plus 10 database tests skipped in CI) pass, along with the Playwright end-to-end suite. This is not a substitute for a later independent security review.

Production launch of this work is still in progress (Phase 2).

## Phase 2 — In progress

- **Live charts** on the Feed, Community, and Cletus Audit screens, driven by real market data.
- **Cletus Verified** for developers, and **Token Boost**. Payments for these features stay disabled. Boosts do not affect the trading engine.
- **Paper positions on the site**, shown from real simulation data only — no mock positions.
- **The Owner's Desk**, a personal operations dashboard built on the existing owner page.
- **Launch** of the redesigned site on cletustechnology.dev and the app on app.cletustechnology.dev, still in simulation, with live trading off.
- **Per-user autonomy setting** for the public launch: each user picks **"Set my limits"** (their own size, position-count and loss limits) or **"Let him fly"** (Cletus sizes and times every trade on his own judgment, with only data-integrity guards). Planned, not built.
- **One fund-moving command.** In either autonomy mode, besides trading swaps, the only thing Cletus can do with funds is withdraw profit to the user's own registered wallet. No code path may send funds anywhere else; a test pins every transfer path in the codebase.

## Phase 3 — Next

These items follow the Phase 2 launch and wallet-connect audits. They are not a commitment to turn live trading on.

- **Multi-network paper trading** on Ethereum, Base, BNB, Polygon, Cronos, and Arbitrum, only after the site is live and wallet audits pass. Solana remains the current home network. Live trading on any network stays off until it is separately and explicitly approved.
- **wagmi 3 upgrade**, treated as its own stage and covered by the wallet end-to-end suite.

## Phase 4 — Agent Council

Specialist agents already exist in the codebase. They are advisory and read-only. None of them can execute trades, sign transactions, custody keys, or move funds.

- **Charlotte** — subscriptions, treasury reporting, and tokenomics review (research only; no token or staking product is offered).
- **Signal & Allocation Analyst** — market evidence, paper allocation proposals, and uncertainty.
- **Defender** — security posture, service health, and maintenance tickets.
- **Guardian** — read-only security review alongside Defender; it does not remediate or clear emergency stops.
- **Operations Steward** — paper-worker, scan freshness, and database health checks for the owner.

A Council screen that brings these agents together is planned next. It is not shipped.

## Phase 5 — Future vision

- **The Grove.** Coming. Details TBA. Cletus is still defining this part of the ecosystem, so this roadmap does not describe a product, timeline, or feature set.
- **Sponsorship and funding.** Once the repository is public, we intend to use GitHub Sponsors to support open-source engineering, testing, documentation, security work, and responsible operations. Sponsorship is support for the project. It is not an investment, not a token sale, and it does not confer trading privileges, equity, or a share of trading results. This roadmap does not set fundraising targets or name sponsors.

Token, staking, or revenue-sharing ideas, if they are ever pursued, would come only after legal, audit, and disclosure requirements are met. None of those programs is offered today.

## Principles

- Simulation first. Live trading stays off until it is explicitly approved.
- Real data only in public performance views. No mock trades or fabricated results.
- No promised returns, and no presentation of paper results as a guarantee of future performance.
- Users control their wallets. Cletus does not collect private keys through the application.
- Status labels stay honest: built, in progress, or future.

The same phases are published on the `/roadmap` page of the redesigned site.
