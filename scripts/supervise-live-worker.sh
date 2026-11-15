#!/usr/bin/env bash
# Keep the live worker running. Restarts it if the process dies. Does not place
# extra trades or change trading config — it only re-runs start-live-worker.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/logs/supervise-live-worker.log"
PIDFILE="$ROOT/logs/live-worker.pid"
mkdir -p "$ROOT/logs"
echo "$(date -Is) supervisor start" >> "$LOG"
while true; do
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    sleep 15
    continue
  fi
  echo "$(date -Is) worker not running; starting" >> "$LOG"
  if ! "$ROOT/scripts/start-live-worker.sh" >> "$LOG" 2>&1; then
    echo "$(date -Is) start-live-worker.sh failed; retry in 30s" >> "$LOG"
    sleep 30
    continue
  fi
  sleep 5
done
