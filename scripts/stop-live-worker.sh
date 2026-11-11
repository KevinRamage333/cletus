#!/usr/bin/env bash
# Stop the box live worker. Does not automatically sell an open position.
# To close positions first, use the owner sell-all / kill switch, then run this.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/logs/live-worker.pid"
# Match the relative script path in the tsx/npx cmdline (not the absolute path).
PATTERN='scripts/live-worker.ts'

collect_pids() {
  local pids=()
  if [[ -f "$PIDFILE" ]]; then
    pids+=("$(cat "$PIDFILE")")
  fi
  local found
  found="$(pgrep -f "$PATTERN" || true)"
  if [[ -n "$found" ]]; then
    while read -r pid; do
      [[ -n "$pid" ]] && pids+=("$pid")
    done <<< "$found"
  fi
  printf '%s\n' "${pids[@]}" | awk 'NF && !seen[$0]++'
}

mapfile -t PIDS < <(collect_pids)
if [[ ${#PIDS[@]} -eq 0 ]]; then
  echo "no live worker process found"
  rm -f "$PIDFILE"
  exit 0
fi

for PID in "${PIDS[@]}"; do
  if kill -0 "$PID" 2>/dev/null; then
    pkill -P "$PID" 2>/dev/null || true
    kill "$PID" 2>/dev/null || true
  fi
done

for _ in $(seq 1 20); do
  leftover="$(pgrep -f "$PATTERN" || true)"
  [[ -z "$leftover" ]] && break
  sleep 0.25
done

leftover="$(pgrep -f "$PATTERN" || true)"
if [[ -n "$leftover" ]]; then
  while read -r pid; do
    [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
  done <<< "$leftover"
fi

rm -f "$PIDFILE"
echo "stopped live worker pids ${PIDS[*]}"
