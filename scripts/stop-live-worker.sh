#!/usr/bin/env bash
# Stop the box live worker. Does not automatically sell an open position.
# To close positions first, use the owner sell-all / kill switch, then run this.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/logs/live-worker.pid"
PIDS=()
if [[ -f "$PIDFILE" ]]; then
  PIDS+=("$(cat "$PIDFILE")")
fi
# Also match the tsx/node worker process (npx may be the pid file parent).
while read -r pid; do
  [[ -n "$pid" ]] && PIDS+=("$pid")
done < <(pgrep -f "$ROOT/scripts/live-worker.ts" || true)

# Unique
mapfile -t PIDS < <(printf '%s\n' "${PIDS[@]}" | awk 'NF && !seen[$0]++')
if [[ ${#PIDS[@]} -eq 0 ]]; then
  echo "no live worker process found"
  rm -f "$PIDFILE"
  exit 0
fi

for PID in "${PIDS[@]}"; do
  if kill -0 "$PID" 2>/dev/null; then
    # Kill children first, then the parent
    pkill -P "$PID" 2>/dev/null || true
    kill "$PID" 2>/dev/null || true
  fi
done

for _ in $(seq 1 20); do
  alive=0
  for PID in "${PIDS[@]}"; do
    if kill -0 "$PID" 2>/dev/null; then alive=1; fi
  done
  [[ $alive -eq 0 ]] && break
  sleep 0.25
done
for PID in "${PIDS[@]}"; do
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID" 2>/dev/null || true
  fi
done
rm -f "$PIDFILE"
echo "stopped live worker pids ${PIDS[*]}"
