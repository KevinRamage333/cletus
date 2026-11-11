# Cletus database plan (production)

**Decision (2026-11-11):** Neon is dropped. Production runs on **self-hosted PostgreSQL**, owned by the operator's LLC, on an **Oracle Cloud Always Free VM**. It's the same box as the trading worker. Development stays on SQLite through Prisma. Nothing in this plan has been deployed yet.

## One database, three logical areas (Postgres schemas)

| Schema | Owner role | What lives there | Written by |
|---|---|---|---|
| `app` | `cletus_app` | Users, onboarding acceptances, accounts, positions/trades, logs, signal weights, engine state, Brain conversations/messages, news, journal, community | The Next.js app + trading engine (Prisma) |
| `llc_records` | `cletus_llc` | Business expenses, contracts, trademark/ideas log, vendor/service records (hosting, RPC, API plans) | Owner/admin tooling only (never the public app) |
| `market_data` | `cletus_md` | Solana pools, swaps, and OHLCV candles collected from Helius streams | A separate indexer process (later); the app reads only |

Keeping them separate lets each have its own role and privileges, backup cadence, and retention. A bug in the public app can never read or write the LLC's records.

### `app` (Prisma-managed)
- Today's `prisma/schema.prisma` models are unchanged. To move to Postgres, set `provider = "postgresql"` and `DATABASE_URL=postgresql://cletus_app:…@127.0.0.1:5432/cletus?schema=app&sslmode=require`, then run `prisma migrate deploy`. Prisma's `multiSchema` preview can map models to schemas later if `app` needs to join `market_data`.
- No floating-point money shortcuts beyond today: PnL is stored as double precision in dev. For production, consider `Decimal` columns for cash and PnL.

### `llc_records` (draft DDL in `docs/sql/schemas.sql`)
- `expenses(id, incurred_on, vendor, category, amount_usd, currency, payment_method, receipt_uri, notes, created_at)`
- `contracts(id, counterparty, title, signed_on, renews_on, value_usd, document_uri, status, notes)`
- `ideas_log(id, logged_on, idea, notes, source)`: the trademark/ideas log, mirrored from `docs/IDEAS_LOG.md`
- No customer PII, tax IDs, or wallet secrets are ever stored here.

### `market_data` (draft DDL in `docs/sql/schemas.sql`)
- `pools(address PK, dex, base_mint, quote_mint, created_slot, first_seen_at)`
- `swaps(signature, pool, slot, block_time, side, base_amount, quote_amount, price_usd, trader)`, partitioned by day on `block_time`
- `candles_1m(pool, bucket, open, high, low, close, volume_usd, trades)` with PK `(pool, bucket)`, rolled up to `candles_5m`, `candles_1h` and `candles_1d`
- Fed by an **indexer** that subscribes to Helius WebSocket/Geyser-style streams for watched pools (open positions, scanner candidates). It decodes swaps and upserts 1-minute candles. The goal is to serve our own `/api/tokens/chart` from here and keep GeckoTerminal as the fallback. See IDEAS_LOG, 2026-11-11.
- Retention: raw swaps 30–90 days; candles kept indefinitely (they're small).

## Access: SSL-only, restricted
- Postgres listens on `127.0.0.1` (the app and worker are on the same VM). If remote admin access is ever needed, use an SSH tunnel or WireGuard; **never open 5432 to the internet** in the Oracle security list or the VM firewall.
- `ssl = on` with a server certificate. Use `hostssl` lines only in `pg_hba.conf` (no `host` lines) and `scram-sha-256` auth. Clients use `sslmode=require` (or `verify-full` with the CA).
- One role per area with least privilege: `cletus_app` (CRUD on `app`, SELECT on `market_data`), `cletus_md` (write `market_data` only), `cletus_llc` (owner-only; `llc_records`), and `cletus_backup` (read-only, for dumps). No app role is a superuser.
- Secrets (DB passwords, `DATABASE_URL`) live in the VM's environment or a secrets file with mode 600, never in git. They are added to SECURITY.md's secret list by name only.

## Backups: nightly, encrypted, off-box
- A nightly cron/systemd timer runs `pg_dump -Fc` per schema (`app`, `llc_records`; `market_data` weekly, or candles only).
- Each dump is encrypted before it leaves the VM (`age` or `gpg` with a public key; the private key is kept offline by the LLC). It's then uploaded to Oracle Object Storage (Always Free tier) or another provider, in a bucket with versioning and retention.
- Retention: 7 daily, 4 weekly, and 6 monthly copies. A monthly **restore drill** into a scratch database checks that the backups actually work.
- WAL archiving / PITR can come later if trade volume justifies it.

## Migration steps (when ready)
1. Provision Postgres 16 on the VM, harden `pg_hba.conf` and `postgresql.conf` (SSL, localhost), and create the roles and schemas (`docs/sql/schemas.sql`).
2. Switch the Prisma provider, run `prisma migrate deploy` against `app`, and copy beta data if it's worth keeping.
3. Set up and test the backup timer and a restore.
4. Build the market-data indexer afterwards. Charts keep using GeckoTerminal until it's ready.
