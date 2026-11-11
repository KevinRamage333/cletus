# Cletus database plan (production)

**Decision (2026-11-11):** Neon is dropped. Production runs on **self-hosted PostgreSQL**, owned by the operator's LLC, on an **Oracle Cloud Always Free VM**. It's the same box as the trading worker. **Status (2026-11-11, 8:57 AM CST):** built and running **locally on the build box** while the Oracle account is locked. It's PostgreSQL 17 at `127.0.0.1:5432`, database `cletus`, with the three schemas and four roles below, SSL-only, and Prisma pointed at `app`. To move it to the VM later, see [`scripts/migrate-to-server.md`](../scripts/migrate-to-server.md). SQLite remains an optional dev mode (`npm run db:sqlite`). Nothing has been deployed.

| Piece | File |
|---|---|
| Roles, DB, schemas, grants | `scripts/db-init.sql` + `scripts/db-init.sh` (passwords generated into `.env.local`, chmod 600, never printed) |
| `llc_records` + `market_data` DDL | `docs/sql/schemas.sql` (idempotent; each block runs as its owner role) |
| `app` schema | Prisma migrations in `prisma/migrations/` (`npm run db:migrate`) |
| SQLite → Postgres copy | `scripts/sqlite-to-postgres.mjs` (`npm run db:copy-sqlite`) |
| Backups / restore | `scripts/db-backup.sh`, `scripts/db-restore.sh` |
| 1m candle collector | `src/lib/market-data.ts` (in-process, GeckoTerminal; health at `/api/health` → `marketData`) |
| Postgres integration test | `tests/db.pg.test.ts` (skipped when DATABASE_URL isn't Postgres) |

## One database, three logical areas (Postgres schemas)

| Schema | Owner role | What lives there | Written by |
|---|---|---|---|
| `app` | `cletus_app` (+ read-only on `market_data`) | Users, onboarding acceptances, accounts, positions/trades, logs, signal weights, engine state, Brain conversations/messages, news, journal, community | The Next.js app + trading engine (Prisma) |
| `llc_records` | `cletus_llc` | Business expenses, contracts, trademark/ideas log, vendor/service records (hosting, RPC, API plans) | Owner/admin tooling only (never the public app) |
| `market_data` | `cletus_md` | Solana pools, swaps, and OHLCV candles collected from Helius streams | A separate indexer process (later); the app reads only |

Keeping them separate lets each have its own role and privileges, backup cadence, and retention. A bug in the public app can never read or write the LLC's records.

### `app` (Prisma-managed)
- `prisma/schema.prisma` uses `provider = "postgresql"`, with `DATABASE_URL=postgresql://cletus_app:…@127.0.0.1:5432/cletus?schema=app&sslmode=require`. The initial migration is `prisma/migrations/20261111000000_init`, applied with `npm run db:migrate` (`prisma migrate deploy`). New migrations are generated with `npm run -s db:migrate:new > prisma/migrations/<stamp>_<name>/migration.sql` (diffs the live DB against the schema; no shadow DB or CREATEDB privilege is needed). Prisma's `multiSchema` preview can map models to schemas later if `app` needs to join `market_data`.
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
- **Now:** an in-process collector (`src/lib/market-data.ts`) stores 1-minute candles for open positions and the top 20 scanner picks. It uses the GeckoTerminal OHLCV API through the same token bucket as the charts: ≤ 2 calls/min by default, each pool refreshed every ~5 min, 100 candles per fetch. Tunables are `MARKET_DATA_*` (see `.env.example`), and `MARKET_DATA_COLLECTOR=off` disables it. When GeckoTerminal is rate-limited, `/api/tokens/chart` falls back to these stored candles for the 1H range. Roll-ups are the views `candles_5m`, `candles_1h` and `candles_1d`.
- **Later:** fed by an **indexer** that subscribes to Helius WebSocket/Geyser-style streams for watched pools (open positions, scanner candidates). It decodes swaps and upserts 1-minute candles. The goal is to serve our own `/api/tokens/chart` from here and keep GeckoTerminal as the fallback. See IDEAS_LOG, 2026-11-11.
- Retention: raw swaps 30–90 days; candles kept indefinitely (they're small).

## Access: SSL-only, restricted
- Postgres listens on `127.0.0.1` (the app and worker are on the same VM). If remote admin access is ever needed, use an SSH tunnel or WireGuard; **never open 5432 to the internet** in the Oracle security list or the VM firewall.
- `ssl = on` with a server certificate. Use `hostssl` lines only in `pg_hba.conf` (no `host` lines) and `scram-sha-256` auth. Clients use `sslmode=require` (or `verify-full` with the CA).
- One role per area with least privilege: `cletus_app` (owns `app`, SELECT on `market_data`), `cletus_md` (owns `market_data`), `cletus_llc` (owns `llc_records`; nobody else is granted it), and `cletus_backup` (`pg_read_all_data`, read-only, for dumps). None of them is a superuser or can create roles or databases. `CONNECT` on the DB is revoked from PUBLIC, and so is the `public` schema. Admin work goes through the OS `postgres` user over the unix socket (peer auth); all TCP logins are `hostssl` + scram-sha-256.
- Verified on the box: non-SSL logins are rejected, the app role is denied on `llc_records` and on `market_data` writes, `cletus_md` is denied on `app`, and the backup role can't write.
- Note: the collector currently runs inside the app process with `cletus_md` credentials. Once the Helius indexer exists it moves to its own process/unit, and the app keeps only `cletus_app`.
- Secrets (DB passwords, `DATABASE_URL`) live in the VM's environment or a secrets file with mode 600, never in git. They are added to SECURITY.md's secret list by name only.

## Backups: nightly, encrypted, off-box
- `scripts/db-backup.sh` (nightly cron) runs one `pg_dump -Fc` of the whole `cletus` DB as `cletus_backup` over SSL, streams it through `age` to the public recipient (`.secrets/backup-age.pub`), and writes `…/daily/cletus-<UTC>.dump.age` plus a `.sha256`. Sunday runs are also copied to `weekly/` and 1st-of-month runs to `monthly/`. `BACKUP_OFFSITE_CMD` uploads each file off-box (for example Oracle Object Storage).
- `scripts/db-restore.sh <file>` verifies the checksum, decrypts with the age identity, restores into the scratch DB `cletus_restore_test`, prints row counts and drops it. Restoring over the live DB needs `<file> cletus --force`.
- On the box, the age private key sits in `.secrets/backup-age.key` (chmod 600, gitignored). On the VM, keep only the public key there and the private key offline.
- Retention: 7 daily, 4 weekly, and 6 monthly copies. A monthly **restore drill** into a scratch database checks that the backups actually work.
- WAL archiving / PITR can come later if trade volume justifies it.

## Moving to the Oracle VM
Step-by-step instructions, including SSL, keeping 5432 closed, the SSH tunnel, the restore, cron and a checklist, are in [`scripts/migrate-to-server.md`](../scripts/migrate-to-server.md). The market-data indexer from Helius streams comes after that. Until then, charts use GeckoTerminal and the stored candles are the fallback.
