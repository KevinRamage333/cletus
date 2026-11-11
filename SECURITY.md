# Security

## Secrets (never commit, never log)
| Secret | Purpose | Where |
|---|---|---|
| `TRADING_WALLET_PRIVATE_KEY` **or** `TRADING_WALLET_KEYPAIR_PATH` | Operator wallet that signs live swaps | Server env / `.secrets/trading-wallet.json` (chmod 600) |
| `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `HELIUS_WS_URL` | Primary RPC, WebSocket and DAS (the URLs contain the key) | Server env |
| `FLUXRPC_API_KEY`, `BACKUP_RPC_URL` | Backup RPC for failover (the URL contains the key) | Server env |
| `PRIVATE_RPC_URL` / Jito settings | Optional MEV-protected submission for live swaps | Server env |
| `GEMINI_API_KEY` | Brain, grounded news (optional; the mock is used otherwise) | Server env |
| `SESSION_SECRET` | HMAC signing of session cookies (32+ random bytes) | Server env |
| `DATABASE_URL` | Self-hosted Postgres in production (LLC-owned, Oracle Cloud VM, SSL-only; see docs/DATABASE_PLAN.md) | Server env (mode 600) |
| `RUGCHECK_API_KEY` (+ optional `RUGCHECK_API_URL`, `RUGCHECK_SHIELD_KEY`) | RugCheck via FluxRPC (`X-API-KEY`), with public fallback | Server env |
| `JUPITER_API_KEY`, `XAI_API_KEY` | Optional higher limits / alternate Brain provider | Server env |
| Vercel project + token (or another host) | Deployment | The host's secret store, never the repo |

## Guarantees in code
- The private key is loaded only server-side (`src/lib/wallet.ts`) and never returned by any API or printed. `src/lib/redact.ts` scrubs long base58 strings, 32+ byte arrays and API-key-looking values from every log line.
- `.secrets/` and `.env*` are gitignored (only `.env.example` is tracked).
- Live mode is refused without a key, and refused in beta unless `ALLOW_LIVE_IN_BETA=true`. An unreadable wallet in live mode trips the kill switch.
- Session cookies are HttpOnly, SameSite=Lax, HMAC-SHA256 signed, and Secure in production. A dev-default secret is rejected in production.
- Middleware blocks every route until onboarding is complete, and APIs re-check onboarding against the DB.
- The browser wallet is generated and encrypted client-side. Its seed or secret is never sent to the server; the onboarding API rejects any payload containing secret fields and stores only the public key.
- RPC URLs are used only server-side. `/api/health` and the dashboard expose only endpoint names, latencies and error kinds.
- No tax IDs, SSNs or other government identifiers are collected; the tax API rejects such fields. The tax acknowledgment stores only a timestamp.
- Community posts that look like private keys or recovery phrases are rejected; admins can hide messages and mute users.
- The Dev Wallet Inspector is read-only and throttled per user; Helius URLs and keys never reach the browser.
- The Brain has only read-only tools and cannot place, cancel or size trades.

## Reporting
Use the in-app Feedback / Bug form, or contact the operator privately. Do not post wallet keys or recovery phrases anywhere.
