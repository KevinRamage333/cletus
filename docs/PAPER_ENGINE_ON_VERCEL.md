# Running Cletus paper trading reliably on Vercel

## Why this exists
The trading engine originally relied on `setInterval` timers started by Next.js instrumentation. Vercel serverless instances may freeze or be recycled between requests, so in-process timers are not a dependable production scheduler. The dashboard polling every few seconds does not run the engine.

## Scheduled paper worker
- Vercel Cron calls `/api/cron/paper-engine` once per minute.
- The route is authenticated with `CRON_SECRET`.
- It refuses to run unless `CLETUS_ENGINE_TRANSPORT=cron`, `TRADING_MODE=simulation`, and `ENGINE_DISABLED` is not true.
- It runs one market scan followed by one position-monitor pass.
- A Postgres transaction-scoped advisory lock prevents overlapping invocations.
- Each successful invocation writes a `PAPER_WORKER_HEARTBEAT` row to `LogEntry`.
- The trade screen shows the last worker heartbeat and last successful market scan, so stale data is visible instead of looking live.

## Required Vercel environment variables
Set these for Production (and Preview only if desired), then redeploy:
- `CLETUS_ENGINE_TRANSPORT=cron`
- `CRON_SECRET` = a long random secret. Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>`.
- `TRADING_MODE=simulation` for paper trading.

Do not set `CLETUS_ENGINE_TRANSPORT=cron` while expecting live trading. The cron route deliberately rejects live mode; live execution requires a dedicated persistent worker with its own operational safeguards.

## Cadence and limitations
Vercel Cron runs this worker once per minute. This is near-live paper trading, not a sub-second stream. The browser refreshes the paper session every 8 seconds, while market scans and position monitoring advance on each cron invocation. Vercel plan limits and function duration limits still apply.

## Safety
This route cannot sign or broadcast transactions. It is paper-only and refuses to run when the configured trading mode is live. It does not make any live trading claim.
