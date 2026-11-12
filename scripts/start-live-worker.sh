#!/usr/bin/env bash
# Start the box-only live trading worker. Does not change .env.local TRADING_MODE
# (Next dev and Vercel stay in simulation).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
PIDFILE="$LOG_DIR/live-worker.pid"

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "live worker already running pid $(cat "$PIDFILE")"
  exit 0
fi

export TRADING_MODE=live
export ALLOW_LIVE_IN_BETA=true
export WITHDRAW_LIVE_ENABLED=true
export OWNER_PLAN_ENABLED=true
export MCAP_PRESET=BALANCED
export OWNER_STOP_LOSS_PCT=20
# Taper: sell 50% at +50%; remainder: stop to break-even once peak hits +50%, trail 8% (armed at +50%), full exit at +150%.
export OWNER_TAKE_PROFIT_PCT=150
export OWNER_TP_LADDER=50:50
export OWNER_BREAK_EVEN_TRIGGER_PCT=50
export OWNER_TRAILING_ARM_PCT=50
export OWNER_TRAILING_STOP_PCT=8
# Self-directed exits: each live trade picks its own SL / partial / trail / final inside hard bounds
# (src/lib/adaptive-exits.ts). The fixed taper numbers above are the fallback until a plan exists.
export OWNER_ADAPTIVE_EXITS=on
export OWNER_MAX_OPEN_POSITIONS=1
export WHALE_FAST_EXIT=on
export ENABLE_TRAILING_STOP=false
export HOLD_TIME_MINUTES=10080
# Dead coin can't hold the only slot: exit after 2h if still inside +/-3%.
export STALE_POSITION_MINUTES=120
export STALE_BAND_PCT=3
# Poll dev/whale flow for the open position every 2 min (fast exit only, never a buy trigger).
export WHALE_POSITION_INTERVAL_SECONDS=120
export ENGINE_DISABLED=false
# Opt-in (off by default; see docs/FAST_DATA_PRIVATE_ROUTE.md). Uncomment, then do one controlled restart.
export FAST_PRICE_WS=on        # on-chain position price from each swap via Helius logsSubscribe (Jupiter Price fallback)
export PRIVATE_ROUTE=dryrun    # log a simulated Jito bundle beside each live swap; nothing extra is sent
# Nightly self-retraining (off by default; see docs/RETRAIN.md). Uncomment, then do one controlled restart.
export RETRAINED_WEIGHTS=on     # load the promoted weight set + score threshold from data/weight-sets/registry.json
export WEIGHTS_HOT_RELOAD=on    # re-apply within 60s after a promotion or rollback (no restart)
export RETRAIN_SCHEDULE=on      # run scripts/retrain-weights.ts --apply when >= 20h since the last run (catches up on wake)
# Trade journal + daily review (see docs/JOURNAL.md). Logging/read-only; takes effect at the next restart.
export TRADE_JOURNAL=on          # logs/trade-journal.jsonl: why (score, 8 signals + 6 terms, mcap, liq, vol, mood, exit plan) + what (MFE/MAE, fees, slippage, P&L)
export TRADE_REVIEW_SCHEDULE=on  # writes logs/reviews/YYYY-MM-DD.md + flags.json (yesterday if missing, else refresh after 20h)
# export JOURNAL_FEEDBACK=on     # trade less of flagged setups: +0.025 score bar per flagged entry-time setup, max +0.05
# Holder-sell exit: creator or a top-10 non-pool holder sells >= 20% of its bag (>= 0.1% of supply) or >= 1% of supply -> exit now.
export MIN_BUY_VOLUME_10M_USD=10000
export MIN_BUY_VOLUME_10M_MCAP_PCT=5   # 10m buy vol must clear min($10k, 5% of mcap)
export FADE_MINUTES=15            # volume-fade: move out if 5m volume stays off for more than 15 min
export LOW_VOL_5M_EXIT_USD=1500     # owner rule: no entry under $1.5k 5m volume; sell if 5m volume < $1.5k (after the first 5m candle)
export SCAN_PHANTOM_TRENDING=on   # Phantom Explore trending (1h/4h/12h/24h) as an extra scan source
export MOMENTUM_SCALP=dryrun       # log-only: replay negative OOS (Nov 11), never trades
export KOL_MODE=on                # KOL/pump.fun add-on: X KOL callouts, $5k-$25k, own wallet (KOL_WALLET_KEYPAIR_PATH), +15% TP / -7% SL
export HOLDER_SELL_EXIT=on       # 3-4 RPC calls per open position every HOLDER_WATCH_SEC (120 s); baseline in logs/holder-baselines.json

export PUMP_AGE_FILTER=on         # impulse 0-6h favored; block late+below-anchor; fresh new_pools; waived min token age
# Re-entry cooldown is on by default in code: REENTRY_COOLDOWN_HOURS=24 after a losing live close (0 disables).
export CLETUS_DEMO=0
export NEXT_RUNTIME=nodejs

# Node --env-file does not overwrite these exports.
nohup npx tsx --env-file=.env.local scripts/live-worker.ts >> "$LOG_DIR/live-worker.log" 2>&1 &
echo $! > "$PIDFILE"
echo "started live worker pid $! log $LOG_DIR/live-worker.log"
