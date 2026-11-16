# Cletus Agent Council — Foundation

**Version:** 0.1  
**Status:** Initial implementation; specialist policy modules and tests added  
**Execution posture:** Advisory and read-only by default

Cletus gains three specialist agents. They are separate roles with explicit, application-enforced capability allowlists. They may analyze, report, and recommend; they do not inherit one another's permissions.

## 1. Signal & Allocation Analyst

**Purpose:** Turn market evidence and portfolio constraints into explainable trade research and position-size proposals.

Responsibilities:
- Rank scanner candidates using existing signal scores and documented evidence.
- Review historical paper-trade results and confidence calibration.
- Estimate a risk-bounded position size using equity, cash, reserved fees, current exposure, stop distance, liquidity, slippage, and configured thresholds.
- Explain why an opportunity is a paper candidate, watch item, or skip.
- Track concentration and avoid treating one strong indicator as proof of a profitable trade.

The initial deterministic allocator is in `src/lib/agents/signal-allocator.ts`. It is recommendation-only and returns `execution: "none"`. It does not submit orders or change the live engine. Its output is an additional analysis layer; existing audit, compliance, portfolio, and hard-risk gates remain authoritative.

## 2. Charlotte — subscriptions, staking & tokenomics overseer

Charlotte builds on the existing companion identity in `src/lib/brain/charlotte.ts`.

Responsibilities:
- Organize user-authorized subscription records, estimate monthly recurring costs, and flag duplicate vendors or price increases.
- Report possible savings for human review; never cancel, modify, or charge a subscription automatically.
- Review token supply, circulating supply, treasury concentration, annual emissions, staking deposits, and the funding coverage of any advertised reward rate.
- Flag tokenomics that depend on unsustainable emissions or rewards not covered by an identified budget.
- Challenge hype, hidden fees, misleading APY/APR, and claims that token ownership guarantees income.

The first deterministic audit functions are in `src/lib/agents/charlotte.ts`. They require supplied records and inputs; they do not connect to billing accounts or chain contracts.

Staking and tokenomics remain research-only. No token launch, mint, burn, deposit, withdrawal, reward distribution, treasury transfer, or yield promise is implemented in this milestone. Any eventual public token or staking product needs independent legal, tax, security, economic, and consumer-protection review.

## 3. Defender — security & maintenance

Defender builds on the existing defensive policy in `src/lib/security-defense.ts` and cybersecurity rules in `src/lib/brain/defensive-cybersecurity.ts`.

Responsibilities:
- Review service health, security alerts, dependency metadata, backup checks, and maintenance findings.
- Create incident and maintenance tickets with evidence, impact, confidence, and rollback-aware next steps.
- Recommend containment when a security event warrants it.
- Keep secrets redacted and never request or expose wallet keys, API keys, or recovery phrases.

Defender cannot clear an emergency stop, change permissions, rotate credentials, install dependencies, merge code, deploy, or perform unreviewed security changes. The existing emergency-stop decision logic remains separate and owner-controlled. Resilience means recoverable and well-monitored, not impossible to shut down.

## 4. Capability boundaries

The registry in `src/lib/agents/registry.ts` is the source of truth for agent capabilities. The following are not granted to any specialist:
- trade execution or wallet signing;
- custody or movement of funds;
- subscription payments or cancellation;
- staking deposits or withdrawals;
- token minting, burning, or distribution;
- raw secret access or disabling security controls.

Prompt text is not an authorization system. Any future tool call must check the registry server-side and enforce user/account scope independently.

## 5. Build sequence

1. **Foundation (this PR):** role registry, pure allocation advisor, Charlotte audit functions, Defender triage wrapper, tests, and this operating charter.
2. **Read-only runtime wiring:** connect each specialist to scoped data sources; add evidence provenance, timestamps, and per-user authorization.
3. **Owner dashboard:** display recommendations, subscription findings, tokenomics risk, security tickets, and agent status.
4. **Evaluation:** historical paper-trading analysis, false-positive/false-negative review, tokenomics stress tests, incident drills, and permission tests.
5. **Controlled actions:** only after independent review, add narrow owner-approved workflows. Financial execution, payments, staking, and bank functions remain separate permission domains.

## 6. Exposure and revenue path

Before any public launch, establish:
- verified paper-trading performance with fees, slippage, failed fills, liquidity constraints, drawdowns, and out-of-sample evaluation;
- clear disclosure that past simulated results do not predict future returns;
- a documented fee model and transparent conflicts of interest;
- privacy and consent controls for user data;
- security review, incident response, backups, and service monitoring;
- appropriate legal and tax review for subscriptions, token distribution, staking, marketing, and any paid financial functionality.

This project must not manufacture trading volume, coordinate pumps, promise returns, or market speculative token exposure as passive income. Public exposure should describe tested capabilities and limitations accurately.

## 7. Explicit non-goals

This milestone does not create a bank, broker, investment adviser, custodian, payment processor, token issuer, or staking provider. It does not connect agents to live billing accounts, wallets, or private keys. It does not enable unattended live trading or fund movement.
