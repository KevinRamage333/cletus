# Cletus Tech launch checklist: cletustechnology.dev
<!-- Repo copy of the launch checklist. Never put secrets, connection strings or project ids here. -->
Updated 2026-11-18 PST. Branch `redesign/gold-ecosystem` (PR #98 → master). Master (#99 community feed, #97 heartbeat) merged in; one moderated community feed.
Nothing here is merged to master or deployed to production. Vercel stays in simulation mode.

## Done (on PR #98)
- [x] PR #98 review findings H/M/L fixed or reworded, plus the Nov 18 items B1, N1, N2, N4, N5, N8, N9 and the re-review items R1, R2 and the N8 leftovers. Conflicts with master (#99) resolved; #103 and #100 are merged into this branch, so merge order #103 → #100 → #98 stays clean. Still open: N6 (same-ticker chart notice), N7 (Vercel WAF rate limits), M5 (vitest 3), M9 (live repo worker lock).
- [x] Listing hardening: unknown honeypot/tax fails; /api/verified, /api/boost **and /api/listings** apply latest-record-wins and a live re-check (1h cache, cap 50) and drop on failure; a vanished pool drops the badge; a cold re-check with sources down fails closed; rate limits are per instance (WAF still open); single-use nonce returns 503 instead of a memory fallback when a DB is configured; host check on /api/verified/*; Token-2022 risk checks; ERC-1271/6492.
- [x] Community privacy (overview, chart, ticker): only opted-in, non-banned members' paper trades count; participant, open-position and token counts, collective P&L, the chart (min 5 accounts per point) and most-traded are hidden until 5+ members are behind them. **Not fully closed:** with exactly 5 contributors the gains/losses split and winning/losing trade counts can still narrow to one person (L-103a), and there is no member data-deletion path yet (L-103b).
- [x] Paper book from Neon (paper_sim, read-only role) on Dashboard, Portfolio, Trade, Feed, Community, labelled "Paper trading · simulated", with real trades.
- [x] Withdraw gating: real sends need TRADING_MODE=live + WITHDRAW_LIVE_ENABLED=true + the operator key, none of which are on Vercel. **Not yet "own wallet only":** owner withdraw accepts any valid on-curve Solana address, and Base sim-withdraw accepts any EVM address (simulated only; its cash debit is now conditional, N9). Before WITHDRAW_LIVE_ENABLED is ever set: allowlist, daily cap, owner signature at confirm, DB cooldown.
- [x] Gates on the merged tree: see the PR #98 body for current tsc / vitest / build / Playwright / npm audit results.
- [x] Paper trader running unrestricted (paper only) with a supervisor, keeper, staleness restarts, clean env and a publisher.

## Remaining before launch
### Domain / Vercel
- [ ] cletustechnology.dev → 308 to www, and www serves 200 from Vercel. Confirm www is the intended production project and branch. Check which deployment it serves today.
- [ ] app.cletustechnology.dev has no DNS/HTTPS. Add it in Vercel and DNS, or drop APP_HOST from site.ts and SIWS hosts.
- [ ] Cletus approves the PR #98 merge to master. Then a production deploy (needs Cletus's go).
### Environment (Vercel project env; never commit)
- [ ] PAPER_READ_DATABASE_URL (a read-only role) set on Preview and Production, or the paper book shows "unavailable".
- [ ] TRADING_MODE=simulation, SESSION_SECRET (32+), OWNER_WALLET, DATABASE_URL (production Neon), SIWS_ALLOWED_HOSTS or NEXT_PUBLIC_APP_URL = the www host.
- [ ] Run `prisma migrate status` on prod Neon (read-only) first, then `prisma migrate deploy` for every pending migration. Expected pending if prod is at the pre-#99 state:
  - 20261117120000_community_feed (from master / #99)
  - 20261117180000_withdraw_confirm_nonce (onboarding wallet step 500s without it)
  - 20261117190000_cletus_verified_token_boost (CletusVerification and TokenBoost)
  - 20261118090000_community_moderation_append_only (from fix PR #103, once merged)
- [ ] Confirm WITHDRAW_LIVE_ENABLED and USER_SWAP_EXECUTE_ENABLED are unset on Vercel, no operator key on Vercel, CLETUS_SYNTHETIC_PAPER unset on Vercel, and decide CLETUS_DEMO. Set COMMUNITY_ANON_SALT (16+ chars) or rely on SESSION_SECRET.
- [ ] NEXT_PUBLIC_WALLET_CONNECT_ENABLED stays off until wallet flows are signed off. They pass e2e with mock wallets; they still need a real-wallet manual check.
- [ ] GECKO_CHART_RPM (default 5), optional Stripe keys for Boost checkout (Boost stays off without them).
### Keys / services
- [ ] JUPITER_API_KEY in .env.local returns 401 (invalid or expired). Paper uses keyless quotes. Live, or any keyed Jupiter call, needs a new key from portal.jup.ag.
- [ ] Snyk: the CLI isn't installed or authenticated on the box. Authenticate (snyk auth, or the Snyk connector) and run SCA and Code on PR #98.
- [ ] Secret scan of full git history (gitleaks/trufflehog) before making the repo or site public. Semgrep p/secrets on the tree found 0, but history isn't scanned.
### Dependencies
- [ ] wagmi 3 / WalletConnect major upgrade (its own stage, with the wallet e2e). This clears the zod / decode-uri-component highs. npm audit prod: 0 critical / 36 high / 20 moderate, all wallet-library transitive. picomatch GHSA-fc5q-39xc-vjpf has no fixed release.
- [ ] vitest 2 → 3 (tinypool criticals are dev-only; documented in SECURITY_AUDIT.md).
### Old-code cleanup
- [ ] scripts/screenshot.mjs drives the removed signup/onboarding flow and fails. Delete it or port it to the e2e screenshot path (E2E_SHOT_DIR).
- [ ] Legacy pre-redesign routes and redirects (old guest routes are redirected): remove dead pages and components once the redirects have run for a release.
- [ ] Semgrep `bypass-tls-verification` (PG_SSL_CA unset) in scripts and market-data. Set PG_SSL_CA or accept it.
- [ ] CI actions pinned by tag, not SHA.
### Repo
- [ ] Add .github/FUNDING.yml for KevinRamage333 (e.g. `github: [KevinRamage333]`). Not present yet. Needs Cletus to confirm the sponsor handles.
### Decisions for Cletus
- [ ] Withdraw destinations: protected/withdraw (owner) accepts any valid Solana address, and sim-withdraw Base accepts any EVM address. Flows kept unchanged per instruction. Decide whether to restrict them to the registered wallet.
- [ ] Live worker (/workspace/cletus): the worker-lock race (M9) is fixed only in the PR copy. The live repo is untouched pending Cletus's go. Same for any unrestricted mode on live (paper only today).
- [ ] Per-user autonomy ("Set my limits" / "Let him fly"): roadmap only.
