# Cletus — ideas & design decisions log

A dated record of feature ideas and design decisions, kept for the owner's records. Dates are America/Chicago.

| Date | Idea / decision | Notes |
|---|---|---|
| 2026-11-11 | Project name "Cletus": autonomous Solana micro-cap trader with a dashboard and an AI "Brain" | Built from scratch on Next.js 14 + TypeScript; the public upstream repo was used only as a reference |
| 2026-11-11 | Simulation-first: `TRADING_MODE=simulation` is the default (paper fills on live data, nothing signed) | Live mode requires an explicit opt-in plus a wallet key |
| 2026-11-11 | Scanner band $10k–$500k market cap, ranked by 24h volume / market cap | DexScreener discovery feeds plus search queries to widen the universe |
| 2026-11-11 | 8 weighted signals with self-learning weights (amplify on wins, dampen on losses, floor plus normalisation) | Spec rules: volume spike = 5m vol > 5% mcap; breakout = > 5% in 5m; buy pressure = buys > 70% of 5m txns |
| 2026-11-11 | `MIN_MARKET_VOLUME_24H` is in USD, default 10000 | Bug fix versus the guide |
| 2026-11-11 | Progressive sizing tiers 1.0/1.5/2.0/2.5/**3.0x** at $0/10k/20k/40k/60k+ | 3.0x at $60k+ used everywhere (the PDF summary said 2.5x; the guide wins) |
| 2026-11-11 | Pre-trade audit that fails closed: mint/freeze authority, LP lock, honeypot sell-route, holder concentration | RugCheck + Jupiter |
| 2026-11-11 | SEC-style compliance gate: volume share, liquidity share, wash-trade window, velocity | Later the same day made **strict** (a breach blocks) with size pre-capped to the limits |
| 2026-11-11 | Self-healing: raise the priority fee, widen slippage, pause after repeated failures | |
| 2026-11-11 | Kill switch: anyone can trigger it, only an admin can release it; closes all positions | Sells to SOL rather than USDC |
| 2026-11-11 | Five presets as env vars, with no "expected profit" claims | Conservative is the live default; later made the default in every mode |
| 2026-11-11 | Gemini model is configurable (default gemini-2.5-flash) with an offline mock fallback | |
| 2026-11-11 | Excluded on purpose: token sale, staking, profit-sharing, donation wallets, "untaxable bank" / offshore treasury, return marketing | |
| 2026-11-11 | Dedicated operator wallet, secret stored only in `.secrets/` (chmod 600, gitignored) | Public key only is ever shown |
| 2026-11-11 | Beta mode: per-tester paper accounts, email sign-up, feedback / bug form, risk disclaimer | |
| 2026-11-11 | Onboarding gate: full Terms (scroll to end + checkbox), full-page Risk Disclaimer, browser wallet create/import | Acceptances recorded with version and timestamp; a version bump forces re-acceptance; the legal text needs lawyer review |
| 2026-11-11 | Browser wallet: BIP-39 phrase, SLIP-0010 m/44'/501'/0'/0', PBKDF2 + AES-GCM, kept in localStorage only | The server stores only the public key |
| 2026-11-11 | Idea: 2000 USD minimum 5-minute volume for the volume-spike signal | **Added, then reverted the same day**; the PDF rule (5m vol > 5% of mcap) is the source of truth |
| 2026-11-11 | The Brain: multi-turn chat with per-user persistent memory and the spec persona | First-class `/brain` page plus a dashboard panel |
| 2026-11-11 | Brain self-awareness via read-only function calls into live state (positions, PnL, weights, healing, blocks, config) | Advisory only: no trading tools, and execute requests are refused |
| 2026-11-11 | News module: CoinDesk, Cointelegraph, Decrypt, Reuters/AP (via Google News RSS), Federal Reserve, SOL price, DexScreener trending | Scheduled refresh, stored items, rolling world briefing injected into the Brain; Gemini Google Search grounding when keyed |
| 2026-11-11 | Self-reflection journal after every closed trade and daily | Visible in the UI and to the Brain |
| 2026-11-11 | Extra risk controls (daily loss limit, loss-streak pause, max % of equity per position, top-10 holder cap, dev-exit check, partial take-profits, stale exits, Jito / private submission) and a performance scorecard | Added by a parallel work stream; see `.env.example` |
| 2026-11-11 | Brain providers behind one switch: `BRAIN_PROVIDER=gemini` (default, free tier) → xAI Grok → mock | Grok uses streaming chat completions, function calling and `web_search`; Gemini has free-tier rate limiting, 429 back-off and a news-summary cache |
| 2026-11-11 | Gemini model auto-fallback when the configured model is retired | 2.5 Flash returns 404 for new keys, so it falls back to `gemini-3.5-flash` |
| 2026-11-11 | Market-cap presets: Degen $10k–$500k, **Balanced $250k–$5M (default)**, Safer $5M–$50M | Plus filters: liquidity ≥ $50k, position ≤ 2% of pool, age ≥ 6h, vol ≥ 20% mcap, top-10 < 30% |
| 2026-11-11 | "Preset lab": paper accounts trade all three presets side by side and the scorecard compares them | |
| 2026-11-11 | Portfolio: 20 concurrent positions, 60% exposure cap, 5% per position, no duplicates, max 3 per narrative / dev wallet | Narrative buckets from token names |
| 2026-11-11 | Fast exits: 3s concurrent polling via Jupiter Price v3 plus Helius WebSocket pool subscriptions; realistic simulated fills | Fixes stop-losses filling well past their level |
| 2026-11-11 | On-chain holder concentration via Helius (largest accounts, PDA pools excluded, DAS holder count) | |
| 2026-11-11 | RPC failover: Helius primary, FluxRPC backup, health checks and automatic switch-back | |
| 2026-11-11 | Brand: the official golden-goose artwork as the landing hero and share image; goose-head crop for the logo, favicon and chat avatar; gold #D4AF37 → amber #F59E0B palette | The coins in the art show Bitcoin symbols; the art is kept as-is and not captioned as Bitcoin |
| 2026-11-11 | RugCheck via FluxRPC key (`X-API-KEY`), automatic fallback to the public endpoint | The Shield key is browser-only and is rejected by the server API; it's tried only after the main key |
| 2026-11-11 | Merged the owner's saved multi-page frontend (`/app/*`) and restyled it gold | Demo fallbacks (fake signals, fake audit) removed; every number comes from the engine or a live API |
| 2026-11-11 | Per-user Config page: capital, trading hours, aggression, size/SL/TP, daily target/max loss auto-pause, max positions 1–20 | Stored per account; server safety caps still apply |
| 2026-11-11 | Active trading page with start/pause/resume/stop, close per position, daily PnL bars | Stop closes paper positions only |
| 2026-11-11 | Real-time charts: lightweight-charts + GeckoTerminal OHLCV with trade markers; GeckoTerminal/DexScreener embeds | Server-side rate limiting (25/min) and caching |
| 2026-11-11 | Dev Wallet Inspector + community dev audit via Helius DAS and enhanced transactions | Heuristics only |
| 2026-11-11 | Community chat with profiles and admin moderation | Secret-key and seed-phrase paste guard |
| 2026-11-11 | Tax Center as an acknowledgment plus CSV export; **no tax IDs collected**. 30-day trial flag | Changed from the saved design, which asked for a tax ID |
| 2026-11-11 | Staking page is "Coming soon" information only | No token, staking or purchase features were built |
| 2026-11-11 | Cletus-owned Solana market data store and indexer powering native charts | Helius streams → `market_data` schema (pools, swaps, 1m OHLCV and roll-ups), so we eventually serve our own charts; GeckoTerminal stays as the fallback |
| 2026-11-11 | Production DB: self-hosted Postgres owned by the LLC on an Oracle Cloud Always Free VM (Neon dropped) | Schemas `app`, `llc_records`, `market_data`; SSL-only, localhost, least-privilege roles, nightly encrypted off-box backups. See docs/DATABASE_PLAN.md |
