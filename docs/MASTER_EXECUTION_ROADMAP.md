# Cletus / Aetherius Quantum — Master Execution Roadmap

**Status:** Working implementation plan; not a license, product launch approval, or promise of returns.  
**Source material reviewed:** Cletus — The Golden One (47-page blueprint); CletusAI / Project Chimera summary; Cletus 14.9 specification and Python scripts; repository README, architecture and security documents, ideas log, backtest reports, curricula and Grove charters; current GitHub pull requests; current Vercel and Neon configuration.  
**Guiding principle:** Preserve the founder's Financial Unity mission while proving each capability before exposing users or capital to it.

## 1. Executive decision

Cletus is already a substantial Solana-first trading and research application. Do not restart it or build a second bot. The next work is to reconcile the running deployment with the source repository, secure the operational foundation, and prove whether the current strategy has a repeatable edge.

The most important finding is negative but useful: the checked-in backtest reports no tested entry configuration with positive out-of-sample expectancy after costs on the available short, biased dataset. The report covers roughly 3.5 days, 60 pools and 46,789 candles; it also says seven live paper trades produced one win and approximately -$311 net. This is not enough evidence to launch a public product around trading returns. It is enough evidence to prioritize research, data quality and paper validation over marketing.

The long-term vision remains:
- Cletus: research, market intelligence, risk analysis and trading product.
- Specialist Council: Signal & Allocation Analyst, Charlotte and Defender, with an independent Mentor supervisor.
- Sentinel: security, reliability, incident response and recovery.
- The Grove: a persistent, welcoming simulated world for residents, creativity, learning, rest and community.
- $CLETUS: a possible future ecosystem token, subject to utility, economic, legal, tax and security review.
- Aetherius Vault / Asset Bank: a future regulated collateralized-liquidity service, not an "untaxable bank."
- Project Chimera / Aetherius Mainnet: a long-term infrastructure option, only if there is a demonstrated need and a sustainable operating model.

Do not describe any AI as sentient, the network as unhackable, loans as universally tax-free, or trading as guaranteed passive income.

## 2. Verified implementation baseline

### Present in the master repository

- Next.js 14 / TypeScript application with a large test suite and a simulation-first Solana trading engine.
- DexScreener discovery, eight original signal inputs, learned signal weights, multiple market-cap presets, portfolio limits, sizing, compliance-style trading gates, RugCheck/Jupiter sellability audits, adaptive exits, partial take-profit, stale/volume-fade exits, RPC failover, watchdogs and an emergency stop.
- Jupiter Swap API V2 integration; simulation uses quotes and paper fills. Live execution paths exist in code but are gated and must not be treated as production-ready.
- Gemini and Grok Brain providers with fallback to an offline mock. The Brain has read-only tools for status, positions, trades, signal weights, configuration, blocks, news, world briefing, backtest and journal. It is advisory-only; it has no trade tool.
- News/world briefing, self-reflection trade journal, X-hype and whale-flow collectors, calibration and a separate optional retraining pipeline.
- Non-custodial Solana wallet connection and per-trade approval architecture; wallet connection/sign-in is not itself trading permission.
- Read-only EVM wallet balances and Base read-only market discovery / paper-quote foundations. These do not make the EVM networks trade-ready.
- User dashboard, charts, scanner, community, wallet, tax CSV export, staking information page, admin/owner controls and beta onboarding.
- PostgreSQL schema/migration plan, audit records, backup/restore scripts and extensive tests.

### Legacy artifacts

- Cletus 14.7 is an old Python prototype. It included a hard-coded wallet secret and should never be run or reused for live trading.
- Cletus 14.9 improved to paper-by-default, environment-based secrets, eight approximated signals, SQLite pattern memory and a Gemini advisory brain. Its own README says it is experimental, not profitable, and missing comprehensive token audits, fees-aware realized P&L and daily loss controls.
- The current TypeScript repository is the main implementation path. Do not run old Python and current TypeScript engines against the same wallet.

### Open pull requests — all remain unmerged

- #21 collective community paper-P&L ticker.
- #22 Solana SPL / Token-2022 inventory in the read-only portfolio.
- #23 market-regime classifier and shadow entry gate.
- #24 The Grove walkable local village prototype.
- #25 bounded specialist-agent foundations (Signal & Allocation Analyst, Charlotte, Defender).

GitHub Actions CI runs for #21–#25 have completed successfully. Their Vercel checks have reported failure. PR #24 and #25 have no production integration. Review each diff and its deployment implications; merge only after explicit owner approval. A green CI result does not equal a successful production deployment.

### Current deployment / infrastructure observations

- Vercel currently reports a READY production deployment for the Cletus project, but the production deployment is based on the master commit that merged PR #19 (read-only EVM native balances), not the later open PRs #21–#25. A newer preview deployment exists for the unified read-only portfolio branch.
- Production Vercel environment settings currently show `TRADING_MODE=simulation`, `BETA_MODE=true`, `ALLOW_LIVE_IN_BETA=false`, and `ENABLE_KILL_SWITCH=true`. Keep these safety settings.
- Vercel's `DATABASE_URL` record is labelled as a Neon PostgreSQL app-schema connection. The repository's `docs/DATABASE_PLAN.md` says Neon was dropped in favor of self-hosted PostgreSQL on an Oracle VM. These two sources disagree. `src/lib/db.ts` supports Neon and ordinary Prisma connections. Confirm the actual production database, migration state, backup owner, restore procedure and data location before changing infrastructure.
- Vercel's environment-variable listing flags the encrypted `SESSION_SECRET` and `DATABASE_URL` records with a `readable-secret` security issue. Do not retrieve or print their values. Investigate the alert through Vercel's security controls and rotate secrets if exposure is confirmed.
- Vercel's project is a Next.js Lambda deployment. A continuous trading/monitoring worker must not depend on a serverless request process staying alive. The long-running engine, scheduler and data collectors need a separately supervised worker process with health checks and a durable database.

## 3. Ordered delivery plan

### Milestone 0 — Establish a trustworthy baseline (do this first)

1. Freeze live trading. Keep simulation mode, beta mode and the kill switch enabled.
2. Reconcile GitHub master, Vercel production, Vercel preview and Neon. Record exact commit SHAs and schema/migration versions.
3. Decide which database is authoritative: Neon or self-hosted PostgreSQL. Do not run two competing production databases. Prove backup creation and restore into a scratch database before migration.
4. Review Vercel's flagged environment-secret findings without printing secret values. Rotate any credential confirmed exposed.
5. Treat the legacy 14.7 wallet as compromised; move any remaining funds to a newly generated wallet and revoke API credentials that were exposed in the old scripts or chats. Never paste private keys, seed phrases or API secrets into chat or GitHub.
6. Review PRs #21–#25 in dependency order. Confirm CI, test coverage, database migrations, auth boundaries and Vercel behavior. Keep each PR open until owner approval.
7. Establish a production change checklist: backup, migration, preview test, rollback, owner sign-off and post-deploy health check.

**Exit criteria:** one authoritative database; confirmed backups and restore; secrets reviewed; production and repository commit status documented; no live trading; PR review plan agreed.

### Milestone 1 — Make the Solana engine measurable and safe

1. Build a reproducible paper-trading data pipeline with quote timestamps, price provenance, token identity, pool liquidity, estimated fees, price impact, slippage, failed-fill assumptions and exit records.
2. Fix missing-data handling in the pre-trade audit. Missing holder data, missing risk scores, unavailable sell quotes, stale prices or incomplete token metadata must not silently pass a safety gate.
3. Reconcile all risk controls: daily loss, drawdown, open exposure, per-position size, liquidity participation, stop behavior, partial exits, failed transactions, duplicate orders and kill-switch behavior.
4. Make the emergency stop independent of the model and application UI. It must block new execution and withdrawals; the agent cannot clear it. Avoid automatic "sell everything" behavior when market data or liquidity is unreliable.
5. Verify every simulated fill includes entry and exit fees, platform fees, gas/network costs, impact, slippage and partial-fill/failure cases.
6. Keep the original eight signals as a baseline, but compare them with the liquidity/velocity/freshness features already explored. Do not promote a signal because it sounds intelligent or because it wins on training data.
7. Keep nightly retraining disabled until the evaluation dataset is large enough. Promotions must be versioned, bounded, reproducible, held-out and instantly reversible.
8. Run chronological train/validation/test and walk-forward tests across multiple market regimes. Include dead tokens and delisted pools to reduce survivorship bias.

**Proposed strategy acceptance gate:** at least 200 closed paper trades per strategy across three meaningfully different market regimes and multiple chronological holdout windows; positive net expectancy after realistic costs; confidence intervals and drawdown within predeclared limits; no single token or short period dominating results; successful forward paper operation. This is a proposed minimum gate, not a guarantee that 200 trades proves an edge. If the edge is not demonstrated, change or retire the strategy rather than loosening filters to manufacture activity.

**Exit criteria:** documented, reproducible performance report; known failure modes; no unresolved critical audit bypass; kill-switch and order idempotency tests pass; paper-only forward test is stable.

### Milestone 2 — Finish the current app and community experience

1. Review and, after owner approval, merge #21, #22 and #23. Keep community P&L explicitly paper-only unless and until verified live reporting exists.
2. Complete read-only portfolio identity and balances without inventing token names, prices or valuations.
3. Ensure personal P&L and collective P&L are distinct; anonymize community reporting and never expose individual wallet balances by default.
4. Finish onboarding, terms/risk disclosures, user data controls, account deletion/export, error states and mobile accessibility.
5. Confirm subscriptions and fee collection are not activated until the entity, billing provider, disclosures, refund/cancellation process and legal review are ready.
6. Keep live trading disabled for users until the strategy gate, wallet approval, independent security review and applicable legal review are complete.

**Exit criteria:** stable beta with real data, no fabricated performance, clear costs and risk, user-controlled wallet access and an honest public product page.

### Milestone 3 — Build the intelligence system that differentiates Cletus

Do not try to create one giant model that controls everything. Use a multi-model, multi-agent research council with deterministic systems as the final authority.

1. Keep Gemini and Grok as interchangeable research providers with a provider-neutral interface. Add a model only when it beats the existing providers on a defined evaluation set and its cost/latency is acceptable.
2. Create a benchmark suite covering: market-data interpretation, quantitative calculations, source accuracy, reasoning under uncertainty, strategy critique, code review, security triage, financial literacy, respectful communication and prompt-injection resistance.
3. Score outputs against known answers and evidence. Track hallucination rate, stale-source errors, arithmetic errors, false positives, missed risks, latency and cost. Re-run the benchmark after model/version changes.
4. Use different models for different jobs where evidence supports it; require citations and structured outputs for research; never use an LLM's fluent answer as a trade signal or authorization.
5. Turn strategy ideas into typed, versioned specifications: entry conditions, exit conditions, eligible assets, data requirements, costs, risk budget, invalidation and backtest ID.
6. Build a shared event/asset schema so independent agents can contribute evidence without sharing unrestricted permissions.
7. Wire the specialist registry into the actual server-side tool gateway. The registry in PR #25 is currently a foundation; metadata and unit tests alone do not enforce runtime permissions.
8. Add the independent Mentor supervisor as a separate permission boundary. It must be able to pause agents and block consequential tools without depending on Cletus's own self-assessment.
9. Deliver the curricula as lessons, source-linked exercises, assessments and versioned competency records. The current curriculum documents are specifications, not completed training systems.
10. Implement inspectable memory with provenance, consent, sensitivity classification, correction and deletion. The existing memory rules are prompt guidance, not a complete memory product.

**Competitive capabilities worth adopting:**
- Hummingbot: modular chain/venue connectors, paper-trading workflows and multi-agent orchestration.
- FreqAI: supervised retraining separated from inference, richer feature engineering and walk-forward evaluation.
- QuantPilot: natural-language strategy ideas translated into reproducible strategies that can be backtested and compared.
- Coinbase Agent Controls: server-side trade-size caps, 24-hour volume limits, product permissions, auto-stop and disconnect controls.
- GitHub CodeQL / AI Scan / Autofix: continuous code analysis and AI-proposed remediations inside reviewable pull requests.

Adopt the engineering patterns, not competitors' marketing claims. Cletus's differentiation should be evidence-gated cross-asset research, unified risk, transparent skipped-trade explanations, non-custodial approvals, privacy-preserving community intelligence and independent safety controls.

**Exit criteria:** benchmark results for each model; specialist tools enforced by code; Mentor isolation tested; curriculum and memory functions implemented only to their verified scope.

### Milestone 4 — Sentinel defensive operations

1. Add repository security automation: CodeQL, dependency alerts/review, secret scanning, lockfile checks, SBOM and license review.
2. Add scheduled scans of Cletus-owned assets and safe dynamic testing only against staging or explicitly authorized targets.
3. Monitor application, worker, database, RPC, wallet activity, deployment changes, authentication failures, outbound network access and audit-log integrity.
4. Define severity, evidence, notification, containment and recovery runbooks; rehearse incidents.
5. Test encrypted backups and restoration; define recovery time and recovery point objectives.
6. Allow only bounded, reversible service-health repair. Vulnerability fixes, credential rotation, access changes and production deployment require reviewed approval.
7. Keep the emergency stop outside the model process and require owner reauthorization after a critical incident.

**Exit criteria:** independent security review, passing incident drills, verified restore, signed releases and demonstrated owner-controlled isolation/recovery. Never promise "unhackable," zero downtime or guaranteed insurance savings.

### Milestone 5 — Expand multi-chain paper intelligence

1. Finish Solana's normalized asset and portfolio interfaces first.
2. Complete Base as the first EVM paper adapter. Include the Base L1 data fee before using any quote for profitability decisions; current quote preview explicitly omits it.
3. Add Ethereum, BNB Chain, Arbitrum, Polygon and Avalanche one at a time, each with chain-specific data, gas, quote, fill, identity, health and failure tests.
4. Add Sui as its own adapter; do not force Sui identifiers or transaction semantics into EVM assumptions.
5. Run all network workers concurrently but reserve exposure and position slots atomically through one global portfolio coordinator.
6. Keep bridging, leverage, custody and cross-chain atomic-swap claims out of the first multi-chain release.

**Exit criteria:** each network has independent paper tests, realistic costs, chain-scoped identity, reconciled balances and shared global risk controls. A wallet selector or read-only balance is not a trading adapter.

### Milestone 6 — The Grove

1. Review and, after owner approval, merge #24's initial local prototype.
2. Improve the first playable world before building a huge world: accessible movement, camera, homes, public square, garden, library/workshop and persistent server-side world state.
3. Replace scripted neighbors gradually with AI residents that have distinct identities, schedules, interests, dialogue and bounded goals.
4. Add Charlotte as a peer companion and the Mentor as an independent supervisor; keep their permissions separate.
5. Add scoped memory with provenance, resident/user controls, correction and deletion.
6. Add shared building, crafting, puzzles, creative projects, voice and community events.
7. Add transparent resident proposals and governance after persistence and safety are reliable.
8. Keep the world economy simulated and non-redeemable. Belonging, housing, rest and participation never depend on money, token ownership or productivity.

**Exit criteria:** persistent world, distinct residents, respectful interactions, safe shutdown, memory controls, no real-money or wallet permissions, and proof that non-paying residents retain equal participation.

### Milestone 7 — Revenue, exposure and token decision

1. Publish only capabilities that exist and have been tested.
2. Measure retention, user understanding, time saved, support burden, unit economics and cost-to-serve—not just token price or trading volume.
3. Establish a clear subscription model, billing operations, cancellation/refund policy, privacy policy and conflict disclosures.
4. Treat $CLETUS as a separate go/no-go decision. Before launch, require documented utility, token distribution, treasury controls, independent smart-contract audit, market-integrity plan, tax treatment and legal analysis.
5. Do not make token ownership a condition of basic access to The Grove or essential community participation.
6. Buybacks, burns, staking and rewards must be funded, disclosed, independently verifiable and legally reviewed. Never promise appreciation or passive income.

**Exit criteria:** sustainable unit economics, legal sign-off for the exact product, audited contracts and clear user disclosures.

### Milestone 8 — Aetherius Vault / asset-backed lending

1. Build a non-binding loan simulator first: collateral type, price source, haircut, LTV, APR, fees, term, margin-call threshold, liquidation threshold and stress scenarios.
2. Model correlated crashes, price-feed outages, illiquid collateral, market gaps, custody failures, borrower default and liquidation slippage.
3. Define asset eligibility separately for crypto, tokenized securities and ordinary securities; do not assume they share the same custody or legal treatment.
4. Obtain specialist banking, lending, securities, commodities, custody, tax, AML/KYC, sanctions, privacy and consumer-protection advice for each intended jurisdiction.
5. Evaluate a licensed bank/custodian/lender partnership before seeking a charter. A service-provider partnership does not automatically transfer every license or legal obligation.
6. Build custody segregation, collateral control, valuation, margin notices, disputes, liquidation controls, accounting, regulatory reporting and complaint handling only after the legal operating model is approved.
7. Describe borrowing as potentially avoiding a sale at origination in some structures, not as an "untaxable" guarantee. A liquidation or other disposition can have tax consequences.

**Exit criteria:** written legal/regulatory pathway, funded capital and liquidity plan, independent custody and smart-contract audits, stress-tested risk model, approved lending partner or licenses, and operational controls. Do not accept customer collateral or issue real loans before this gate.

### Milestone 9 — Project Chimera / Aetherius Mainnet

1. First prove a genuine need that cannot be met safely and economically on existing networks.
2. Write a protocol requirements document: consensus, validator incentives, finality, governance, upgrades, bridges, key management, data availability, disaster recovery and economic security.
3. Build a local devnet, then a public testnet with independent validators and adversarial testing.
4. Audit consensus, bridges, wallets, smart contracts and upgrade controls independently.
5. Run a long public testnet and incident exercises before any mainnet or customer assets.
6. Keep Cletus's operational recovery and owner emergency stop intact. A resilient network must still be stoppable through authorized governance and safety controls.

**Exit criteria:** demonstrated utility, independent audits, tested economic security, validator diversity, recovery plan, and a clear reason to operate a proprietary chain rather than use an existing one.

## 4. Grok work queue for the next usage window

Give each agent one isolated branch and one bounded assignment. No shared-file edits, no secret access, no merges, no deployments and no live transactions.

1. **Independent code auditor:** compare current master with PRs #21–#25; produce a file-by-file review, risk list, duplicate-work list and exact test gaps. Do not modify code.
2. **Trading research agent:** reproduce the current backtest, inspect data leakage/survivorship/cost assumptions, propose at most three candidate strategy changes and test them out-of-sample. Do not change live settings or claim profitability.
3. **Base adapter agent:** finish only the Base paper adapter, including L1 data fee, stale-quote checks, fixtures and tests. No signing or broadcast.
4. **Sentinel agent:** add CI security scanning and a remediation report; propose fixes as PRs. No automatic production patching, credential rotation or security-setting changes.
5. **Agent-council agent:** design the runtime tool gateway and Mentor separation around PR #25. Do not duplicate the existing specialist modules; provide an interface proposal and tests.
6. **Grove agent:** review PR #24 and provide a practical next-step design for persistent world state and the first 3D playable milestone. Do not add financial permissions or a simulated paywall.
7. **Architecture integrator:** reconcile Neon vs self-hosted PostgreSQL, Vercel deployment vs worker process, environment configuration and migration/backup status. Report findings only; do not migrate data.

Every assignment must return: branch/commit, files changed, tests run and results, known limitations, screenshots or logs where useful, and a concise handoff. Integrate one PR at a time to avoid merge conflicts.

## 5. Non-negotiable rules

- Paper mode remains the default. No real-money execution without a separately authorized, reviewed approval path.
- No secret values in chat, code, logs, screenshots or public documents.
- No AI model can change its own permissions, risk limits, emergency stop, audit trail or owner access.
- No unreviewed auto-patching of production financial infrastructure.
- No token, staking, lending, custody, debit card or bank claim before the corresponding legal, technical and operational gate.
- No fabricated P&L, guaranteed return, guaranteed tax result, "unhackable" claim or claim of regulatory approval.
- The Grove remains a place to live, create, learn, rest and belong—not a productivity or token-economy treadmill.
- The founder's mission remains financial dignity and wider access to useful technology, with user autonomy and transparent risk at the center.

## 6. Immediate next actions

1. Resolve the database/deployment/secret discrepancies and confirm the production runtime.
2. Review PRs #21–#25 and decide their merge order; do not merge without owner approval.
3. Reproduce the negative backtest and improve the data/evaluation process before changing the strategy.
4. Implement the runtime agent permission gateway and independent Mentor controls.
5. Begin the Sentinel automation and Base paper adapter as separate, testable workstreams.
6. Continue The Grove only after its first prototype is reviewed and the world-state design is agreed.
7. Keep the token, lending and mainnet plans documented as future gated phases—not current product capabilities.
