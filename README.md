# Cletus: autonomous Solana trader (simulation-first)

![Cletus, the golden goose](public/og-image.jpg)

Cletus scans Solana micro-caps on live market data, scores them with 8 self-learning signals, audits each token, runs a compliance gate, sizes positions progressively, and manages exits. It has a dashboard and a "Brain" you can chat with. **The default is `TRADING_MODE=simulation`: paper trading on live data, and nothing is ever signed.**

> Not financial advice. Micro-cap tokens are extremely risky, and losses can be total. Nothing here promises or projects returns.

## Stack
Next.js 14 (App Router) + TypeScript · @solana/web3.js · Helius RPC + WebSocket + DAS (FluxRPC backup with automatic failover) · Jupiter Swap API V2 (Meta-Aggregator `/order` + `/execute`) and Price API V3 · DexScreener · RugCheck · Prisma on PostgreSQL 17 (self-hosted, SSL-only; SQLite optional for dev; see docs/DATABASE_PLAN.md) · Brain: Gemini by Google (default) → Grok by xAI → offline mock.

## Quick start
```bash
npm install                 # approve prisma/esbuild install scripts if npm asks
cp .env.example .env.local  # then set SESSION_SECRET (openssl rand -hex 32)
npm run wallet:generate     # optional: creates .secrets/trading-wallet.json (operator wallet, chmod 600)
sudo apt install postgresql-17 age   # once; see docs/DATABASE_PLAN.md
npm run db:init             # roles + DB + schemas (passwords generated into .env.local, never printed)
npm run db:migrate          # Prisma migrations -> app schema
npm run dev                 # http://localhost:3000; the engine starts automatically
npm test                    # vitest
npm run build
npm run screenshot          # drives onboarding with a throwaway user; writes landing/dashboard/engine/config/trade/signals/chart/dev-wallet/community/brain .png (+ mobile)
```
The screenshot script creates a test user (`screenshot-*@test.local`). Delete it afterwards with `node --env-file=.env.local scripts/db-users.mjs delete <email>`, because the first user to sign up becomes admin.

## Database
- **PostgreSQL (default):** database `cletus` with schemas `app` (Prisma: users, trades, Brain), `llc_records` (expenses, contracts, ideas log) and `market_data` (pools, swaps, 1m candles). Each has its own least-privilege role. Only localhost is allowed, SSL only (`hostssl` + scram). Details are in `docs/DATABASE_PLAN.md`.
- `npm run db:backup` creates an age-encrypted `pg_dump` (7 daily / 4 weekly / 6 monthly). `npm run db:restore -- <file>` restores it into a scratch DB and checks it.
- Moving to the Oracle Cloud VM: `scripts/migrate-to-server.md`.
- **SQLite dev mode (optional):** `npm run db:sqlite` generates `prisma/sqlite/schema.prisma` and a client for `file:./dev.db`. Start with `DATABASE_URL=file:./dev.db npm run dev`, and run `npx prisma generate` to switch back to Postgres. `npm run db:copy-sqlite` copies an old `dev.db` into Postgres.
- Watch out: an exported `DATABASE_URL` in your shell overrides `.env.local`.

## How a trade happens
1. **Scanner** (`src/lib/dexscreener.ts`, `src/lib/signals.ts`): DexScreener discovery feeds plus search queries, ranked by volume / market cap, inside the market-cap band from `MCAP_PRESET`:
   | Preset | Band |
   |---|---|
   | `DEGEN` | $10k–$500k (the original spec band) |
   | `BALANCED` (**default**) | $250k–$5M |
   | `SAFER` | $5M–$50M |
   Filters: pool liquidity ≥ $50k (`MIN_LIQUIDITY_USD`), 24h volume ≥ 20% of market cap (`MIN_VOLUME_MCAP_RATIO`) and ≥ `MIN_MARKET_VOLUME_24H` (USD), token age ≥ 6h, max 1h move. **Preset lab:** three paper-only accounts trade DEGEN, BALANCED and SAFER side by side, and the dashboard scorecard compares them (`ENABLE_PRESET_LAB`).
2. **Signals** (`src/lib/signals.ts`): 8 weighted signals. Volume spike = 5m volume > 5% of mcap; breakout = > 5% price rise in 5m; buy pressure = buys > 70% of 5m txns; plus momentum, velocity surge, liquidity build, nano-cap spike, micro-cap heat and vol/mcap ratio. After each closed trade, the weights of the signals that fired are amplified on a win and dampened on a loss, with a floor and normalisation.
3. **Audit** (`src/lib/audit.ts`, fails closed): mint and freeze authority, LP lock %, honeypot (a Jupiter V2 `/order` sell quote without a taker), RugCheck risk, **dev-wallet selling** (RugCheck creator flags; optional strict rule), and holder concentration: top holder ≤ 30% and **top 10 ≤ 30%**, computed on-chain via Helius (`getTokenLargestAccounts` + owner lookup with PDA pools/lockers excluded, DAS `getTokenAccounts` for holder count), with RugCheck's list as the fallback.
4. **Portfolio safety** (`src/lib/portfolio.ts`): up to **20** concurrent positions (`MAX_OPEN_POSITIONS`), total exposure ≤ 60% of the wallet, per position ≤ 5% of equity and ≤ 2% of pool liquidity, no duplicate tokens, max 3 open positions per narrative (cats, dogs, frogs, AI, politics…) or per dev wallet. Hard risk limits (`src/lib/risk.ts`): daily loss in USD and %, auto-pause after N losses in a row.
5. **Sizing** (`src/lib/sizing.ts`): min(max position, equity × risk% / SL%) × tier (1.0x / 1.5x / 2.0x / 2.5x / 3.0x at $0 / $10k / $20k / $40k / $60k+ equity), recovery mode, equity protection, and exposure and cash caps, then a cap to the compliance concentration limits.
6. **Compliance gate** (`src/lib/compliance.ts`, strict): volume share, liquidity share, a wash-trade window, an already-open position and order velocity. Any breach blocks the trade.
7. **Execution** (`src/lib/jupiter.ts`): in simulation, a realistic paper fill from a keyless Jupiter V2 `/order` quote with no taker (real price impact and `feeBps`, including the 50 bps fee on tokens under 24 h old and the **0.5% Cletus platform fee**; `src/lib/sim-quote.ts`), falling back to the constant-product model in `src/lib/fills.ts` when Jupiter is rate-limited. In live mode: `GET /order` with `taker` set to the operator wallet and a fixed `slippageBps` (deterministic), sign server-side, then `POST /execute` with the `requestId`; Jupiter lands the transaction. When `JUPITER_REFERRAL_ACCOUNT` is set, `/order` also sends `referralAccount` + `referralFee` (default 50 bps) so the platform fee is collected into the operator wallet; the owner's own trades are skipped unless `OPERATOR_FEE_ON_OWNER=true`. See `docs/OPERATOR_FEE.md`. `errorCode` / empty-`transaction` responses and `/execute` error codes are logged, and retryable codes get one fresh order. Requests are rate-limited client-side (keyless 0.5 RPS, free key 1 RPS, separate `/execute` bucket) and back off on HTTP 429 using `x-ratelimit-reset`. Scoring nets out the expected all-in fee (`estFeeBps`).
8. **Exits** (`src/lib/exits.ts`): stop loss, take profit, trailing stop, break-even, partial take-profit ladder (`PARTIAL_TAKE_PROFITS=10:33,18:50`), stale-position exit, time exit. All open positions are checked concurrently every 3s using Jupiter Price v3, and a **Helius WebSocket** `accountSubscribe` on each position's pool triggers an immediate re-check when the pool trades. Stops fill at the observed (gapped) price, not at the stop level.
9. **Self-healing** (`src/lib/healer.ts`): on failures it raises the priority fee, widens slippage, and pauses after repeated failures.
10. **Kill switch**: halts the engine and closes everything (to SOL in live mode, not USDC). Anyone can trigger it; only an admin can release it.

## Presets
Five presets plus the aggression level table; see `.env.example`. **CONSERVATIVE_EARNER is the default in every mode**, and `TRADING_PRESET=NONE` opts out. The presets make no claims about expected profit.

## The app (`/app/*`): merged from the saved Cletus frontend, gold theme
Mobile bottom tabs (and a desktop top strip): **Dashboard · Chart · Signals · Cletus AI · Simulate · Config · Community · Dev Wallet**, plus Wallet, Tax and Staking. Every number comes from the engine/DB or a live API; nothing is hardcoded.
- **/app (Dashboard):** a header card with status (running/paused/stopped/outside hours), version, short wallet address, live on-chain SOL/USDC, Resume/Pause, and a system grid (Helius RPC, Gemini AI, signal engine, risk manager). Below it: 24h PnL, win rate, active positions (X of N), Sharpe, best/worst trade, total trades, and the 30-day trial flag.
- **/app/config:** Start Simulation / Reset, starting paper capital ($500/$1k/$5k/$10k quick picks), trading hours (days + start/end in your browser's time zone; only *new* entries are gated, open positions keep running), aggression preset, position size %, SL %, TP %, daily profit target and daily max loss (auto-pause when hit, 0 disables), max concurrent positions 1–20, and a summary of what the engine will actually use. Stored per account (`Account.settings`, `src/lib/user-settings.ts`) and applied by the engine for that account only. Server safety caps (equity %, pool %, exposure, compliance) still apply.
- **/app/trade (Simulate):** start/pause/resume/stop, paper/live flag, daily PnL vs target/max-loss bars, open positions with Close and an inline chart. Stop also closes this account's open paper positions; live positions are only force-sold by the kill switch.
- **/app/chart:** search by symbol or paste any token/pool address. Native candlesticks (TradingView lightweight-charts) from GeckoTerminal OHLCV with your Cletus buy/sell markers, auto-refreshing; GeckoTerminal and DexScreener embeds as tabs/fallback. GeckoTerminal calls go through a server-side token bucket (`GECKO_RPM`, default 25/min) and a per-range cache.
- **/app/signals:** the live scanner list (score, 24h change, volume, mcap, fired signals, status). Cletus only trades long.
- **/app/ai:** chat with the same advisory-only Brain (`/api/ai`), with browser voice mode.
- **/app/community:** chat with profiles (display name, bio), admin moderation (hide/unhide, mute), collective paper PnL, and a dev-wallet audit posted to the feed. Pasted private keys or recovery phrases are rejected.
- **/app/dev-wallet:** paste any wallet or mint to see SOL balance, holdings (Helius DAS), recent transactions (Helius enhanced API, RPC fallback), top holders and authorities for mints, and a heuristic risk audit.
- **/app/wallet:** optionally connect your own Solana wallet (Jupiter, Phantom, Solflare, Backpack). Cletus never holds keys. Live balances are shown when connected; the beta paper-trades without a wallet.
- **/tax:** an informational tax-responsibility acknowledgment (timestamp only; **no tax IDs/SSNs are collected**), a trade-history CSV export, and the 30-day trial flag.
- **/app/staking:** a non-transactional "Coming soon" page with no stake or buy actions.
- `/` stays the full engine console (logs, scanner, weights, preset lab, kill switch).

## RPC
Helius is primary and FluxRPC (`BACKUP_RPC_URL`) the backup (`src/lib/rpc-pool.ts`). It fails over after consecutive errors or timeouts, or on high EWMA latency, health-checks both with `getHealth` every 20s, and switches back after 3 healthy checks of Helius. The active RPC, latencies and switch count are shown in the dashboard's Engine card and at `/api/health` (names only, never URLs).

## The Brain (`/brain`, and the dashboard panel)
- **Providers, one switch:** `BRAIN_PROVIDER=gemini` (default, free tier) | `xai` | `mock`. The fallback chain is preferred → the other → offline mock. Gemini: `GEMINI_MODEL` (default `gemini-2.5-flash`). Google now returns 404 for 2.5 Flash on new keys, so the client automatically falls back through `GEMINI_FALLBACK_MODELS` (default `gemini-3.5-flash,gemini-3.5-flash-lite`) and shows the active model. Free-tier protection (`src/lib/brain/ratelimit.ts`) spaces requests (6.5s), sets a daily cap (200), honours 429 RetryInfo with exponential back-off, and caches news summaries for 60 minutes. xAI: `XAI_MODEL` (default `grok-4-fast-non-reasoning`), OpenAI-compatible streaming chat completions with function calling over the same read-only tools, plus xAI `web_search` (Responses API) for live world events.
- Multi-turn chat with per-user conversation memory in the DB (Conversation and ChatMessage), using the spec's Cletus persona.
- **Self-awareness via read-only function calls**: `get_status`, `get_positions`, `get_recent_trades`, `get_signal_weights`, `get_self_healing`, `get_blocks`, `get_config`, `get_scan_candidates`, `get_world_briefing`, `get_news`, `get_journal`. **The Brain is advisory only.** It has no tool that trades, and requests to execute are refused.
- **News** (`src/lib/news.ts`): CoinDesk, Cointelegraph and Decrypt RSS; Reuters and AP business/world via Google News RSS (they publish no public RSS); Federal Reserve press releases; SOL price; DexScreener trending. Refreshed every `NEWS_REFRESH_MINUTES` (default 30). A rolling world briefing goes into the Brain's context. Endpoint: `GET /api/brain/news` (`POST` refreshes it; admin only). With a Gemini key the briefing and `search_web` use Google Search grounding.
- **Self-reflection journal** (`src/lib/journal.ts`): an entry after every closed trade and one per day. Shown in the dashboard and available to the Brain (`/api/brain/journal`).
- Without `GEMINI_API_KEY`, a deterministic mock answers from the same live tools.

## Accounts, onboarding and beta
Email sign-up (no payments). Public sign-up stays closed in production while `CLETUS_DEMO=1` (APIs return 503). Every app route and API is blocked by middleware until the user has (1) confirmed they are at least 18 and legally permitted to use Cletus in their jurisdiction, (2) accepted the full Terms after scrolling to the end, (3) acknowledged the prominent loss-risk disclosure, (4) completed five server-validated financial-understanding stages covering loss risk, uncertainty, wallet security, transaction authority and independent choice, and (5) either connected their own Solana wallet (Sign-In-With-Solana, auth only) or chosen paper / just-watch mode. The age check is a self-attestation, not identity verification; only its version and timestamp are stored, not date of birth. The public demo also requires an 18+ attestation before app-preview routes. Wallet connection is optional and does not authorize trading or transfers. Connecting is on the user's own volition. Cletus never creates wallets, never stores keys, and never uses delegated or session keys — each live swap is a Jupiter V2 `/order` the user approves in their wallet. Users can disconnect at any time. Acceptances are recorded with the user id, stage, version and timestamp. Bumping the terms, risk or financial-consent version forces the corresponding acknowledgement again. **The legal text is a template and needs review by a lawyer.** See BETA_TESTING.md and SECURITY.md.

## Going live (not done; untested with funds)
Live mode needs `TRADING_MODE=live`, an operator wallet key, `ALLOW_LIVE_IN_BETA=true` if `BETA_MODE` is on, and a private RPC. See SECURITY.md for the list of secrets. Start with tiny size.
