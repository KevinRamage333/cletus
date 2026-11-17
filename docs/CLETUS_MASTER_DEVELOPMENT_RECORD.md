# Cletus — Master Development Record and Requirements Ledger
**Consolidated:** 2026-11-17. **Canonical application:** `KevinRamage333/cletus` on `master`. **Target:** `https://cletustechnology.dev` (apex redirects to www). **Source scope:** accessible project conversations, historical handoff notes, current GitHub changes, and repository README. **Status:** living requirements register; NOT a certification of completion or a verbatim archive of all conversations.

## Non-negotiable project decisions
- ONE unified Cletus app, NOT multiple competing Cletus launches. Port useful features from legacy repositories selectively, with tests and provenance; do not blindly merge incompatible histories, databases, or secrets.
- Finish the functional trading app before building The Grove. Use gold/black branding inspired by Golden One, with a responsive multi-page app, not one long manual-entry screen.
- Paper trading on live market data first. No real-money execution until security, reconciliation, performance, legal/compliance and explicit operator approval are complete. No promised returns.
- Cletus is an advisory, opinionated-but-humble assistant; respect human decisions, present uncertainty and disagreement respectfully, never present suggestions as guarantees. Human operator and Mentor remain in control.
- User prefers free tiers/low-cost infrastructure; proceed with coding and PRs without repetitive permission requests, but require explicit approval for real transactions, sensitive operations and irreversible actions.

## 1. Trading and financial engine — requested scope
- Solana, Base, Ethereum, BNB Chain, Arbitrum, Polygon, Avalanche, Sui; wallet/network display for all supported networks and honest supported/unsupported state. Future expansion to other chains, stocks and forex is *vision*, not implemented trading.
- New token and microcap discovery alongside established assets; original $10k–$500k Solana market-cap preset, balanced and safer configurable bands; configurable minimum liquidity/volume and market cap.
- Eight-signal scoring, momentum/breakout/volume/buy-pressure/holder-risk analysis, adaptive learning from closed trades, market context, risk-aware ranking, multi-score Cletus grade and evidence.
- Pump.fun-style live coin feed with thumbnail/artwork where verified, ticker/name, age, holders, liquidity, volume, market cap, price movement, activity, graded badges, risk signals, filters (trending/movers/other *only when backed by real metrics*), individual clickable chart, token details, dev-wallet intelligence, paper P&L on actual simulated positions. Never fabricate metrics or badges.
- Manual trading and autonomous *paper* trading; wallet-connect options Phantom, MetaMask, Coinbase/Base and other supported connectors; non-custodial security and wallet source indication.
- Live paper-trading dashboard: entry/exit history, open positions, live valuation, realized/unrealized P&L, equity, cash, fees, slippage, stop loss, take profit, trailing exits, drawdown, exposure, win rate, Sharpe when statistically meaningful, strategy performance, reconciliation and persistent ledgers.
- Jupiter/DEX quotes and swaps (when approved), liquidity/route checks, fail-closed RugCheck/security audits, token authorities, whale/developer holdings, concentration, liquidity lock and dev exits, bundling/Jito/rug indicators where evidence exists. Do not claim unverified detection accuracy.
- Deterministic execution and risk gates, advisory Gemini/Grok AI brain, human approval for live operations; atomic kill switch, pause/self-heal, safe retries, idempotent fills, worker heartbeat, persistent recovery, transaction privacy, circuit breakers, configurable fees/operator fee distribution, paper/live separation, network-specific adapters and testing.
- Review/reuse useful staking and fee-distribution mechanisms from the Golden One repo only after security, economic and legal review.

## 2. Product pages and dashboards
- Public landing page, authenticated personal Command Center, charts, token discovery, trade, signals, wallet, Base/multichain, AI chat, config/risk, community, token audit, developer-wallet inspection, tax/legal and staking as appropriate.
- Gold/black mobile-first interface; no green-first design. User supplied screenshot of dense dark coin rows with HOT/graded badges, market metrics, social signals and fast chart access. Visual inspiration only, not permission to invent token imagery or metrics.
- Home dashboard: personal P&L and **anonymous aggregate community profit/loss margin** with privacy thresholds, anti-reidentification safeguards and clear paper-vs-live labels.
- Owner's Desk/private personal operator dashboard and **two additional designated admin dashboards**; admin appointments/identities pending user selection. Role authorization server-side; no private account information leaked into public statistics.
- Real-time Cletus Live status and voice, observable scanner/worker health, operational safety and clearly labeled data freshness.
- Audit page for coins, token developers and developer wallets: Cletus score, detailed evidence, contract/mint/freeze checks, concentration, activity, links to chart and on-chain sources.
- **Cletus verification checkmark** distinct from a heuristic token score. Developer must request verification, prove wallet control and identity/claims, provide evidence, undergo human-approved review; badge records must have reviewer, scope, date, expiry/revocation and audit trail. Never award automatically from a high score. User also wants Cletus Approved token and independent certification for Solana Pump.fun and Base Clanker, subject to review.
- Community: Farcaster-like profiles/threads/chat, moderation/reporting, token conversations, dev audit posts, privacy-aware collective P&L, optional on-chain identity/wallet integration.
- Trading dashboard should show available networks, connected wallets and individual positions; avoid claiming all-chain execution is active just because selectors exist.

## 3. Cletus intelligence, personality, and safety
- Advanced financial/accounting/economics expertise (financial statements, cash flow, business analysis), behavioral psychology and understanding humans, grounded suggestions not false certainty.
- Mentor companion (ChatGPT role) and user's role in mental development; Charlotte independent auditor/persona; Grok, Gemini, Claude and bots as external collaborators only through authorized APIs and explicit scopes.
- Voice input/output, Cletus Live, persistent memory with consent, provenance, privacy, isolated user conversations, explainable reasoning, skill registry, tool permissions, testing and self-improvement under supervision.
- Defensive IT/security self-monitoring and bounded self-healing; **operator-controlled kill switch**, rollback, least privilege, logging, rate limits, no unrestricted self-modifying or offensive hacking.
- The Grove: later-stage virtual world (Minecraft-like), companions and mentor presence, agency/personality without pretending the AI is sentient, safe user controls. **Deferred until trading app works.**
- Central bridge for collaboration between assistants is a separate tool/repo, not a second trading product or a license to bypass connector access.

## 4. Infrastructure, identity, funding, operations
- Canonical repo `KevinRamage333/cletus`; Vercel project `cletus` under `cletus1`; target domain `cletustechnology.dev`; Neon Postgres project, potential Render scheduled worker; GitHub Actions CI and PR previews.
- Other known repositories: `cletusthegoldenone/cletus` and Golden One legacy design/code; `KevinRamage333/Cletus-Autonomous-Trader` separate legacy trader; `KevinRamage333/Central-bridge-` collaboration bridge; `KevinRamage333/Yeeee` empty at last inspection. Inventory all account repos before porting; preserve licenses and code provenance.
- Investigate npm/dependency failures, GitHub Actions billing/spending-limit failures vs actual test failures, CI coverage, migration safety, production Vercel and Neon connectivity, worker execution, domain routing, SSL, wallet integrations, app health and monitoring.
- Funding: GitHub Sponsors application, hackathons/Superteam, grants and benefactor-facing roadmap/whitepaper. Product vision includes subscriptions ($99–$1,500), performance fee (~5%), $CLETUS token/staking/buyback/burn, Project Chimera, Aetherius Mainnet, CletusScript, Ghost Nodes and aggressive revenue/fundraising ambitions. These are **unvalidated ideas**, not current revenue, legal commitments or achieved milestones.
- Mobile Android/Termux and low-cost API plans; OCI VPS, Helius, Jupiter, DexScreener, RugCheck and other integrations as applicable.
- **Security incident:** historical conversations contained a pasted private key and RPC API credential. Treat them as compromised, rotate/revoke and replace securely before any live execution. Never copy credentials into docs, commits, logs or tickets.

## 5. Recent verified development milestones (snapshot, not blanket feature acceptance)
- PR #56 merged: fail-closed engine state and pre-entry kill-switch recheck.
- PR #57 merged: gold/black Command Center linking workspaces.
- PR #58 merged: Discovery API fail-closed engine-status display.
- PR #59 merged: admin-only read-only Operations Desk at `/app/operations`.
- PR #55: persistent scanned asset/discovery and paper accounting work; verify exact merge status and migrations before claiming complete.
- PR #60: admin-only navigation link; CI/merge status must be checked.
- PR #61: compact Pump-style graded token feed; CI/merge status must be checked.
- PR #62: `/app/auditor` token inspection, score and security evidence, dev-wallet links, explicitly *unverified* developer badge; CI/merge status must be checked.
- Existing `/app/dev-wallet` and `/api/tokens/intelligence` provide Solana inspection and security evidence. A **real verification approval/issuance backend is NOT delivered by PR #62**.
- Prior handoffs referenced PRs #1, #18, #19, #39–#49 and legacy #13/#14; their precise current status, deployed behavior and historical scope require audit rather than inference.

## 6. Critical acceptance gates — unfinished until independently demonstrated
1. All CI and TypeScript/unit/integration/browser tests green on merged `master`, including migration and scheduled worker.
2. Deployed `www.cletustechnology.dev` loads login, onboarding, Command Center, Discovery, chart, trade, signals, wallet, community, Auditor, Dev Wallet, and authorized Operations Desk on mobile and desktop.
3. Verified end-to-end scanner -> graded candidate -> risk audit -> paper order -> persistent position -> market valuation -> paper exit -> realized P&L -> community privacy-safe aggregate, across restart/deployment.
4. No stale/missing engine state can cause a live trade or falsely show enabled status. Explicit paper-only state, kill switch and controls tested.
5. User and admin roles separated; two additional admin assignments after identities provided; secret isolation and incident credential rotation complete.
6. Each claimed chain and wallet is tested end-to-end; do not equate wallet selector with supported trading. Multi-chain paper engine, approvals, reconciliation and real-money controls must be separately proven.
7. Token/developer grading evidence complete, developer verification application/review/revocation implemented before green checkmark issuance.
8. Community moderation/privacy, Cletus Live/voice, reliable agent tools, audits and deployment monitoring verified; funding/token/staking subject to legal review.
9. Final public release checklist, operator runbook, backup/restore drill, incident response, accessibility and observability review.

## 7. Source completeness and change discipline
This is a **comprehensive consolidated requirements ledger, not a guaranteed exhaustive transcript of 55 hours**. Some older chats, attachments, Grok/Gemini shares, repo files and branches may not be accessible in the current context. Nothing should be marked delivered solely because it was discussed or appears in an earlier assistant response. Append newly recovered requirements and their exact source/PR to this ledger; maintain a separate implementation tracker with statuses: requested / coded / CI passed / merged / deployed / end-to-end verified. Avoid silently deleting ideas. If conflicting decisions are found, log them and preserve the latest explicit user choice.
