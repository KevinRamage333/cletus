# Cletus: autonomous Solana trader (simulation-first)

![Cletus, the golden goose](public/og-image.jpg)

Cletus scans Solana micro-caps on live market data, scores them with 8 self-learning signals, audits each token, runs a compliance gate, sizes positions progressively, and manages exits. It has a dashboard and a "Brain" you can chat with. **The default is `TRADING_MODE=simulation`: paper trading on live data, and nothing is ever signed.**

> Not financial advice. Micro-cap tokens are extremely risky, and losses can be total. Nothing here promises or projects returns.

## Stack
Next.js 14 (App Router) + TypeScript · @solana/web3.js · Helius RPC + WebSocket + DAS (FluxRPC backup with automatic failover) · Jupiter (quotes, swaps, Price v3) · DexScreener · RugCheck · Prisma (SQLite in dev; self-hosted Postgres planned, see docs/DATABASE_PLAN.md) · Brain: Gemini by Google (default) → Grok by xAI → offline mock.

## Quick start
```bash
npm install                 # approve prisma/esbuild install scripts if npm asks
cp .env.example .env.local  # then set SESSION_SECRET (openssl rand -hex 32)
npm run wallet:generate     # optional: creates .secrets/trading-wallet.json (operator wallet, chmod 600)
npm run db:push
npm run dev                 # http://localhost:3000; the engine starts automatically
npm test                    # vitest
npm run build
npm run screenshot          # drives onboarding with a throwaway user; writes landing/dashboard/engine/config/trade/signals/chart/dev-wallet/community/brain .png (+ mobile)
```
The screenshot script creates a test user (`screenshot-*@test.local`). Delete it afterwards with `node --env-file=.env.local scripts/db-users.mjs delete <email>`, because the first user to sign up becomes admin.

## How a trade happens
1. **Scanner** (`src/lib/dexscreener.ts`, `src/lib/signals.ts`): DexScreener discovery feeds plus search queries, ranked by volume / market cap, inside the market-cap band from `MCAP_PRESET`:
   | Preset | Band |
   |---|---|
   | `DEGEN` | $10k–$500k (the original spec band) |
   | `BALANCED` (**default**) | $250k–$5M |
   | `SAFER` | $5M–$50M |
   Filters: pool liquidity ≥ $50k (`MIN_LIQUIDITY_USD`), 24h volume ≥ 20% of market cap (`MIN_VOLUME_MCAP_RATIO`) and ≥ `MIN_MARKET_VOLUME_24H` (USD), token age ≥ 6h, max 1h move. **Preset lab:** three paper-only accounts trade DEGEN, BALANCED and SAFER side by side, and the dashboard scorecard compares them (`ENABLE_PRESET_LAB`).
2. **Signals** (`src/lib/signals.ts`): 8 weighted signals. Volume spike = 5m volume > 5% of mcap; breakout = > 5% price rise in 5m; buy pressure = buys > 70% of 5m txns; plus momentum, velocity surge, liquidity build, nano-cap spike, micro-cap heat and vol/mcap ratio. After each closed trade, the weights of the signals that fired are amplified on a win and dampened on a loss, with a floor and normalisation.
3. **Audit** (`src/lib/audit.ts`, fails closed): mint and freeze authority, LP lock %, honeypot (a Jupiter sell-route quote), RugCheck risk, **dev-wallet selling** (RugCheck creator flags; optional strict rule), and holder concentration: top holder ≤ 30% and **top 10 ≤ 30%**, computed on-chain via Helius (`getTokenLargestAccounts` + owner lookup with PDA pools/lockers excluded, DAS `getTokenAccounts` for holder count), with RugCheck's list as the fallback.
4. **Portfolio safety** (`src/lib/portfolio.ts`): up to **20** concurrent positions (`MAX_OPEN_POSITIONS`), total exposure ≤ 60% of the wallet, per position ≤ 5% of equity and ≤ 2% of pool liquidity, no duplicate tokens, max 3 open positions per narrative (cats, dogs, frogs, AI, politics…) or per dev wallet. Hard risk limits (`src/lib/risk.ts`): daily loss in USD and %, auto-pause after N losses in a row.
5. **Sizing** (`src/lib/sizing.ts`): min(max position, equity × risk% / SL%) × tier (1.0x / 1.5x / 2.0x / 2.5x / 3.0x at $0 / $10k / $20k / $40k / $60k+ equity), recovery mode, equity protection, and exposure and cash caps, then a cap to the compliance concentration limits.
6. **Compliance gate** (`src/lib/compliance.ts`, strict): volume share, liquidity share, a wash-trade window, an already-open position and order velocity. Any breach blocks the trade.
7. **Execution**: in simulation, a realistic paper fill (constant-product price impact for the trade size, `src/lib/fills.ts`). In live mode, a Jupiter swap signed server-side and sent via the standard RPC, a private RPC or a Jito block engine (`SWAP_SUBMISSION_MODE`).
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
- **/app/wallet:** your browser wallet's public address with live balances. The beta does not use it to trade.
- **/tax:** an informational tax-responsibility acknowledgment (timestamp only; **no tax IDs/SSNs are collected**), a trade-history CSV export, and the 30-day trial flag.
- **/app/staking:** a non-transactional "Coming soon" page with no stake or buy actions.
- `/` stays the full engine console (logs, scanner, weights, preset lab, kill switch).

## RPC
Helius is primary and FluxRPC (`BACKUP_RPC_URL`) the backup (`src/lib/rpc-pool.ts`). It fails over after consecutive errors or timeouts, or on high EWMA latency, health-checks both with `getHealth` every 20s, and switches back after 3 healthy checks of Helius. The active RPC, latencies and switch count are shown in the dashboard's Engine card and at `/api/health` (names only, never URLs).

## The Brain (`/brain`, and the dashboard panel)
- **Providers, one switch:** `BRAIN_PROVIDER=gemini` (default, free tier) | `xai` | `mock`. The fallback chain is preferred → the other → offline mock. Gemini: `GEMINI_MODEL` (default `gemini-2.5-flash`). Google now returns 404 for 2.5 Flash on new keys, so the client automatically falls back through `GEMINI_FALLBACK_MODELS` (default `gemini-3.5-flash,gemini-3.5-flash-lite`) and shows the active model. Free-tier protection (`src/lib/brain/ratelimit.ts`) spaces requests (6.5s), sets a daily cap (200), honours 429 RetryInfo with exponential back-off, and caches news summaries for 60 minutes. xAI: `XAI_MODEL` (default `grok-4.7`), OpenAI-compatible streaming chat completions with function calling over the same read-only tools, plus xAI `web_search` (Responses API) for live world events.
- Multi-turn chat with per-user conversation memory in the DB (Conversation and ChatMessage), using the spec's Cletus persona.
- **Self-awareness via read-only function calls**: `get_status`, `get_positions`, `get_recent_trades`, `get_signal_weights`, `get_self_healing`, `get_blocks`, `get_config`, `get_scan_candidates`, `get_world_briefing`, `get_news`, `get_journal`. **The Brain is advisory only.** It has no tool that trades, and requests to execute are refused.
- **News** (`src/lib/news.ts`): CoinDesk, Cointelegraph and Decrypt RSS; Reuters and AP business/world via Google News RSS (they publish no public RSS); Federal Reserve press releases; SOL price; DexScreener trending. Refreshed every `NEWS_REFRESH_MINUTES` (default 30). A rolling world briefing goes into the Brain's context. Endpoint: `GET /api/brain/news` (`POST` refreshes it; admin only). With a Gemini key the briefing and `search_web` use Google Search grounding.
- **Self-reflection journal** (`src/lib/journal.ts`): an entry after every closed trade and one per day. Shown in the dashboard and available to the Brain (`/api/brain/journal`).
- Without `GEMINI_API_KEY`, a deterministic mock answers from the same live tools.

## Accounts, onboarding and beta
Email sign-up (no payments). Every route and API is blocked by middleware until the user has (1) accepted the full Terms after scrolling to the end and ticking "I have read the entire Terms and Conditions", (2) acknowledged the full-page Risk Disclaimer, and (3) set up a browser wallet: created client-side with the phrase shown once and confirmed, encrypted with the user's password (PBKDF2 + AES-GCM) and kept only in localStorage, or imported. Acceptances are recorded with the user id, version and timestamp. Bumping `NEXT_PUBLIC_TERMS_VERSION` forces re-acceptance. **The legal text is a template and needs review by a lawyer.** See BETA_TESTING.md and SECURITY.md.

## Going live (not done; untested with funds)
Live mode needs `TRADING_MODE=live`, an operator wallet key, `ALLOW_LIVE_IN_BETA=true` if `BETA_MODE` is on, and a private RPC. See SECURITY.md for the list of secrets. Start with tiny size.
