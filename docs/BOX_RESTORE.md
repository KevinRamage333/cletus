# Box restore (Neon + live worker)

The trading worker and its database run on this box. The database lives on **Neon** (Postgres, `app` / `market_data` / `llc_records` schemas). Vercel stays in simulation and does not need the box proxy.

This file is the rebuild checklist. Secrets stay out of git: never commit `.env.local` or anything under `.secrets/`.

## After a box rebuild

1. Check out this repo at `/workspace/cletus` (same path the cron lines use).
2. Restore secrets from the operator copy (mode 600), at least:
   - `.env.local` — `DATABASE_URL`, `BACKUP_DATABASE_URL`, session/API keys, wallet paths. `TRADING_MODE` on this file should stay `simulation` so Next.js / Vercel do not go live. The worker start script sets live mode only for that process.
   - `.secrets/neon-urls.env` — Neon role URLs (app, market_data, llc, backup, owner).
   - `.secrets/backup-age.pub` and, if this box should decrypt backups, `.secrets/backup-age.key`.
   - `.secrets/trading-wallet.json` and `.secrets/kol-wallet.json` (owner keypairs).
3. Install dependencies and generate the Prisma client:

   ```bash
   cd /workspace/cletus
   npm ci
   npx prisma generate
   ```

   `npm ci` already runs `prisma generate` via `postinstall`. Run it again if you only restored env files after install. Confirm with `npm run build` if you want a full check.
4. This box cannot open outbound Postgres `:5432`. The Prisma Neon adapter in `src/lib/db.ts` talks to Neon over WebSockets on 443, and uses an HTTPS proxy **only when** `HTTPS_PROXY`, `https_proxy`, or `NEON_HTTPS_PROXY` is set. On this box the egress proxy is `http://127.0.0.1:8791` (platform-provided, not in this repo). Vercel has no such proxy; if a Neon `DATABASE_URL` is ever set there, the same code uses the adapter without a proxy. Stock Prisma (non-Neon URLs) is unchanged.
5. Optional: `scripts/ensure-neon-tunnel.sh` listens on `127.0.0.1:15432` for tools that still need libpq (`psql`, older dumps). The worker itself does not need this tunnel. `scripts/ensure-postgres.sh` only starts a local Postgres if `DATABASE_URL` still points at localhost (Neon is primary).
6. Install cron (see below) and, if you want the worker up before the next `@reboot` or `*/2` tick, run `scripts/ensure-live-worker.sh` once. Do not do that as a casual restart of a healthy worker.

## Crontab

Current box crontab (America/Chicago). Install by merging these lines into `crontab -e` (do not blindly replace a crontab that has other jobs):

```cron
@reboot /workspace/cletus/scripts/ensure-live-worker.sh >> /workspace/cletus/logs/supervise-live-worker.log 2>&1
*/2 * * * * /workspace/cletus/scripts/ensure-live-worker.sh >> /workspace/cletus/logs/supervise-live-worker.log 2>&1
15 2 * * * cd /workspace/cletus && /workspace/cletus/scripts/db-backup.sh >> /workspace/cletus/logs/db-backup.log 2>&1
```

- `@reboot` and every 2 minutes: `ensure-live-worker.sh` starts `supervise-live-worker.sh` if it is not running. The supervisor restarts the worker if that process dies, or if `logs/scan-latest.json` is older than `WORKER_STALE_SCAN_MINUTES` (default 8) after a start grace, a post-resume grace (`WORKER_SUSPEND_GRACE_MINUTES`, default 3), and two consecutive stale checks — so a box unsuspend does not immediately spawn a second copy. Restarts kill the whole process group and wait until no `scripts/live-worker.ts` process remains; `live-worker.ts` also takes an exclusive flock on `logs/live-worker.lock` and exits if the lock is held. It does not change trading config or place extra trades.
- `15 2 * * *` (2:15 AM CT): encrypted Neon backup via `scripts/db-backup.sh` (SQL dump over WebSockets, `age`-encrypted to `.secrets/backup-age.pub`, kept under `$HOME/cletus-backups`). See `docs/DATABASE_PLAN.md` for retention and restore-drill notes.

## Scripts in this setup

| Script | Role |
|---|---|
| `src/lib/db.ts` | Prisma client: Neon WebSocket adapter when `DATABASE_URL` host is `*.neon.tech`; HTTPS proxy only if a proxy env var is set |
| `scripts/start-live-worker.sh` | Starts the box worker (live mode for that process only) |
| `scripts/supervise-live-worker.sh` / `ensure-live-worker.sh` | Keep the worker running across crashes and reboots |
| `scripts/ensure-neon-tunnel.sh` / `neon-proxy-tunnel.py` | Optional TCP tunnel to Neon through the box HTTPS proxy |
| `scripts/ensure-postgres.sh` | Optional local Postgres 17, only if `DATABASE_URL` is localhost |
| `scripts/db-backup.sh` / `neon-backup-dump.mjs` | Nightly encrypted backup |
| `scripts/neon-exec.mjs` | Apply SQL files to Neon over WebSockets (box-only; reads `.secrets/neon-urls.env`) |
