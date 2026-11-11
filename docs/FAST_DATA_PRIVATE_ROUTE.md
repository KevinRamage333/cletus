# Faster position data and private routing (opt-in)

Both features are **off by default**. A running worker is unaffected until it is restarted with the flags set.

## 1. Fast position price — `FAST_PRICE_WS=on`

| | Default (off) | `FAST_PRICE_WS=on` |
|---|---|---|
| Trigger | Helius `accountSubscribe` on each open pool + 3 s HTTP poll | Helius `logsSubscribe mentions=[pool]` (carries the swap signature) + the same 3 s poll |
| Price on trigger | Jupiter Price v3 (shares the 0.5–1 RPS Jupiter bucket with `/order`; skipped if busy) | Price from that swap's own pre/post token balances (one `getTransaction`, ~25 ms on Helius); Jupiter Price if that fails |
| Burst handling | leading-edge 1 s debounce (drops the last swap of a burst) | trailing 1 s debounce (always checks the latest swap) |
| Safety | — | a fast price more than `FAST_PRICE_MAX_JUMP_PCT` (35) from the last price is not trusted alone (falls back to Jupiter / poll); `getTransaction` 4 s timeout, one retry, overall deadline; WebSocket silent > `WS_STALE_MS` (90 s) is closed and reconnected; the poll, stale-price exit and monitor watchdog are unchanged |
| Visibility | — | heartbeat line adds WebSocket state, events, on-chain / rejected / fallback counts |

Checked read-only on live PumpSwap pools: on-chain swap prices within ~1–4 % of DexScreener (which lags). Uses the existing Helius key; no new key or paid service.

Expected effect: a stop is evaluated on the swap that crossed it (typically < 1 s after it confirms) instead of at the next Jupiter price read, which could be 3 s+ late or skipped under rate limiting.

## 2. Private routing — `PRIVATE_ROUTE=off|dryrun|jito`

Live swaps already land through Jupiter `/execute` (Jupiter Beam: Jupiter's own stake, private until execution, MEV-resistant). This adds an optional Jito bundle path.

- `off` (default): unchanged.
- `dryrun`: unchanged execution; beside each live swap it builds the tip transfer, simulates swap + tip on the RPC, reads Jito's tip floor and logs `private route dry run (nothing sent): ...`. Nothing extra is broadcast.
- `jito` **plus** `PRIVATE_ROUTE_BROADCAST=true`: sends `[signed swap, tip]` as a Jito bundle (atomic: no tip unless the swap lands), waits up to `PRIVATE_ROUTE_LAND_TIMEOUT_MS` (6 s), then always passes the same signed transaction to Jupiter `/execute`, which lands it if the bundle didn't or reports it if it did (same signature, cannot execute twice). If Jito says landed but nothing confirms, it fails without retrying (never a second order). `jito` without the broadcast switch is treated as `dryrun`.
- JupiterZ RFQ and gasless orders always use `/execute`.
- Tip: `JITO_TIP_LAMPORTS` (10,000 ≈ Jito's median landed tip) capped by `PRIVATE_ROUTE_MAX_TIP_LAMPORTS` (20,000), hard ceiling 100,000, minimum 1,000. Cost ≈ 0.000015 SOL per swap including the tip transaction's base fee.

Read-only check (2026-11-11): a real Jupiter order for the trading wallet signed and simulated with its tip tx: swap sim ok (95,658 CU), tip sim ok; Jito median landed tip was 10,000–16,271 lamports.

Recommendation: run `dryrun` for a day; only consider `jito` if logs show Jupiter landing failures. Jupiter Beam is already private, so the expected MEV gain over today is small.

## Turning it on (one controlled restart, owner-approved)

Uncomment the two lines in `scripts/start-live-worker.sh` (or append `FAST_PRICE_WS=on` and `PRIVATE_ROUTE=dryrun` to `.env.local`), then:

```bash
cd /workspace/cletus && scripts/stop-live-worker.sh && scripts/start-live-worker.sh
grep -E "fast price|private route" logs/live-worker.log | tail
```

Open positions are picked up again on start. To turn off: re-comment / remove the lines and restart.
