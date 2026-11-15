#!/usr/bin/env bash
# Ensure the supervisor (and thus the live worker) is running.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/logs/supervise-live-worker.pid"
mkdir -p "$ROOT/logs"
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  exit 0
fi
nohup "$ROOT/scripts/supervise-live-worker.sh" >> "$ROOT/logs/supervise-live-worker.log" 2>&1 &
echo $! > "$PIDFILE"
echo "started live-worker supervisor pid $(cat "$PIDFILE")"
