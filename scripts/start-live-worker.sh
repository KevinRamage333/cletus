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
# export RETRAINED_WEIGHTS=on     # load the promoted weight set + score threshold from data/weight-sets/registry.json
# export WEIGHTS_HOT_RELOAD=on    # re-apply within 60s after a promotion or rollback (no restart)
# export RETRAIN_SCHEDULE=on      # run scripts/retrain-weights.ts --apply when >= 20h since the last run (catches up on wake)
export CLETUS_DEMO=0
export NEXT_RUNTIME=nodejs

# Node --env-file does not overwrite these exports.
nohup npx tsx --env-file=.env.local scripts/live-worker.ts >> "$LOG_DIR/live-worker.log" 2>&1 &
echo $! > "$PIDFILE"
echo "started live worker pid $! log $LOG_DIR/live-worker.log"
