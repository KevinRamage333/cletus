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
export OWNER_STOP_LOSS_PCT=5
export OWNER_TAKE_PROFIT_PCT=20
export OWNER_MAX_OPEN_POSITIONS=1
export WHALE_FAST_EXIT=on
export ENABLE_TRAILING_STOP=false
export HOLD_TIME_MINUTES=10080
export STALE_POSITION_MINUTES=0
export ENGINE_DISABLED=false
export CLETUS_DEMO=0
export NEXT_RUNTIME=nodejs

# Node --env-file does not overwrite these exports.
nohup npx tsx --env-file=.env.local scripts/live-worker.ts >> "$LOG_DIR/live-worker.log" 2>&1 &
echo $! > "$PIDFILE"
echo "started live worker pid $! log $LOG_DIR/live-worker.log"
