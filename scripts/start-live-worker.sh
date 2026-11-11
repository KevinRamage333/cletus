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
export OWNER_TAKE_PROFIT_PCT=50
export OWNER_MAX_OPEN_POSITIONS=1
export WHALE_FAST_EXIT=on
export ENABLE_TRAILING_STOP=true
export TRAILING_ARM_PERCENTAGE=25
export TRAILING_STOP_PERCENTAGE=8
export HOLD_TIME_MINUTES=10080
# Dead coin can't hold the only slot: exit after 2h if still inside +/-3%.
export STALE_POSITION_MINUTES=120
export STALE_BAND_PCT=3
# Poll dev/whale flow for the open position every 2 min (fast exit only, never a buy trigger).
export WHALE_POSITION_INTERVAL_SECONDS=120
export ENGINE_DISABLED=false
export CLETUS_DEMO=0
export NEXT_RUNTIME=nodejs

# Node --env-file does not overwrite these exports.
nohup npx tsx --env-file=.env.local scripts/live-worker.ts >> "$LOG_DIR/live-worker.log" 2>&1 &
echo $! > "$PIDFILE"
echo "started live worker pid $! log $LOG_DIR/live-worker.log"
