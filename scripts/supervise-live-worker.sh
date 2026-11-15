#!/usr/bin/env bash
# Keep the live worker running. Restarts it if the process dies, or if it is alive
# but has not finished a scan within WORKER_STALE_SCAN_MINUTES (default 8).
# Does not place extra trades or change trading config — it only re-runs start-live-worker.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/logs/supervise-live-worker.log"
PIDFILE="$ROOT/logs/live-worker.pid"
SCAN_FILE="$ROOT/logs/scan-latest.json"
STALE_MIN="${WORKER_STALE_SCAN_MINUTES:-8}"
mkdir -p "$ROOT/logs"
echo "$(date -Is) supervisor start" >> "$LOG"

# Exit 0 (true) when the running worker's last scan is older than STALE_MIN minutes.
stale_scan() {
  local pid="$1"
  python3 - "$pid" "$SCAN_FILE" "$STALE_MIN" "$PIDFILE" << 'PY'
import json, os, sys, time
from datetime import datetime, timezone

pid, scan_file, stale_min, pidfile = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
max_age_ms = stale_min * 60_000
if max_age_ms <= 0:
    raise SystemExit(1)
now_ms = time.time() * 1000

started_ms = None
try:
    started_ms = os.path.getmtime(pidfile) * 1000
except OSError:
    pass
# Grace: a just-started worker may not have written scan-latest yet.
if started_ms is not None and now_ms - started_ms < max_age_ms:
    raise SystemExit(1)

scan_at = None
mtime_ms = None
try:
    mtime_ms = os.path.getmtime(scan_file) * 1000
except OSError:
    pass
try:
    with open(scan_file, encoding='utf-8') as f:
        at = json.load(f).get('at')
    if isinstance(at, str):
        s = at.replace('Z', '+00:00')
        scan_at = datetime.fromisoformat(s).timestamp() * 1000
except Exception:
    pass

ref = scan_at if scan_at is not None else (mtime_ms if mtime_ms is not None else started_ms)
if ref is None:
    raise SystemExit(1)
raise SystemExit(0 if (now_ms - ref) >= max_age_ms else 1)
PY
}

restart_hung() {
  local pid="$1"
  echo "$(date -Is) no scan within ${STALE_MIN}m; restarting hung worker ${pid}" >> "$LOG"
  kill "$pid" 2>/dev/null || true
  sleep 2
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
}

while true; do
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    pid="$(cat "$PIDFILE")"
    if stale_scan "$pid"; then
      restart_hung "$pid"
    else
      sleep 15
      continue
    fi
  fi
  echo "$(date -Is) worker not running; starting" >> "$LOG"
  if ! "$ROOT/scripts/start-live-worker.sh" >> "$LOG" 2>&1; then
    echo "$(date -Is) start-live-worker.sh failed; retry in 30s" >> "$LOG"
    sleep 30
    continue
  fi
  sleep 5
done
