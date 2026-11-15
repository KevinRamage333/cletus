#!/usr/bin/env bash
# Keep the live worker running. Restarts it if the process dies, or if it is alive
# but has not finished a scan within WORKER_STALE_SCAN_MINUTES (default 8) after a
# post-resume grace and two consecutive stale checks. Always kills the whole
# process group and waits until no scripts/live-worker.ts process remains before
# starting a replacement. Does not place extra trades or change trading config.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/live-worker-ctl.sh
source "$ROOT/scripts/live-worker-ctl.sh"
cletus_ctl_init
LOG="$ROOT/logs/supervise-live-worker.log"
SCAN_FILE="$ROOT/logs/scan-latest.json"
STALE_MIN="${WORKER_STALE_SCAN_MINUTES:-8}"
GRACE_MIN="${WORKER_SUSPEND_GRACE_MINUTES:-3}"
NEEDED="${WORKER_STALE_CHECKS:-2}"
mkdir -p "$ROOT/logs"
echo "$(date -Is) supervisor start" >> "$LOG"

PREV_WALL=""
PREV_MONO=""
GRACE_UNTIL=0
STALE_STREAK=0

# Prints one line: shouldRestart staleNow staleStreak graceUntil wall mono gap
# Uses wall vs monotonic clock to ignore stale scan files right after a box resume.
supervisor_tick() {
  python3 - "$SCAN_FILE" "$STALE_MIN" "$PIDFILE" "$GRACE_MIN" "$NEEDED" \
    "${PREV_WALL:-}" "${PREV_MONO:-}" "$GRACE_UNTIL" "$STALE_STREAK" << 'PY'
import json, os, sys, time
from datetime import datetime

scan_file, stale_min, pidfile, grace_min, needed = sys.argv[1:6]
prev_wall_s, prev_mono_s, grace_until_s, streak_s = sys.argv[6:10]

def fnum(s, default=None):
    try:
        if s == "":
            return default
        return float(s)
    except Exception:
        return default

max_age_ms = float(stale_min) * 60_000
grace_ms = float(grace_min) * 60_000
needed_n = int(float(needed))
now_wall = time.time() * 1000
now_mono = time.clock_gettime(time.CLOCK_MONOTONIC) * 1000
prev_wall = fnum(prev_wall_s)
prev_mono = fnum(prev_mono_s)
grace_until = fnum(grace_until_s, 0) or 0
streak = int(fnum(streak_s, 0) or 0)
tolerance = 5_000
gap = 0.0
if prev_wall is not None and prev_mono is not None:
    gap = (now_wall - prev_wall) - (now_mono - prev_mono)
    if gap > tolerance:
        grace_until = now_wall + grace_ms
    else:
        gap = 0.0

started_ms = None
try:
    started_ms = os.path.getmtime(pidfile) * 1000
except OSError:
    pass

scan_at = None
mtime_ms = None
try:
    mtime_ms = os.path.getmtime(scan_file) * 1000
except OSError:
    pass
try:
    with open(scan_file, encoding="utf-8") as f:
        at = json.load(f).get("at")
    if isinstance(at, str):
        scan_at = datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp() * 1000
except Exception:
    pass

ref = scan_at if scan_at is not None else (mtime_ms if mtime_ms is not None else started_ms)
stale_now = False
if max_age_ms > 0:
    in_start_grace = started_ms is not None and (now_wall - started_ms) < max_age_ms
    if not in_start_grace and ref is not None and (now_wall - ref) >= max_age_ms:
        stale_now = True

in_grace = grace_until > now_wall
if in_grace or not stale_now:
    streak = 0
else:
    streak += 1
should = (not in_grace) and stale_now and streak >= needed_n
print(f"{int(should)} {int(stale_now)} {streak} {grace_until:.0f} {now_wall:.0f} {now_mono:.0f} {gap:.0f}")
PY
}

restart_hung() {
  echo "$(date -Is) no scan within ${STALE_MIN}m; restarting hung worker (group stop)" >> "$LOG"
  if ! stop_live_worker >> "$LOG" 2>&1; then
    echo "$(date -Is) group stop did not clear all worker processes; not starting a second copy" >> "$LOG"
    return 1
  fi
  return 0
}

while true; do
  if worker_is_running; then
    # Adopt a running tree if the pidfile was lost (e.g. incomplete kill of an npm wrapper).
    if [[ ! -f "$PIDFILE" ]] || ! kill -0 "$(cat "$PIDFILE" 2>/dev/null || echo 0)" 2>/dev/null; then
      first="$(list_worker_pids | awk 'NF{print; exit}')"
      if [[ -n "$first" ]]; then
        write_worker_meta "$first"
        echo "$(date -Is) adopted running worker pid $first" >> "$LOG"
      fi
    fi
    tick="$(supervisor_tick)"
    should="$(echo "$tick" | awk '{print $1}')"
    STALE_STREAK="$(echo "$tick" | awk '{print $3}')"
    GRACE_UNTIL="$(echo "$tick" | awk '{print $4}')"
    PREV_WALL="$(echo "$tick" | awk '{print $5}')"
    PREV_MONO="$(echo "$tick" | awk '{print $6}')"
    gap="$(echo "$tick" | awk '{print $7}')"
    if [[ "${gap:-0}" != "0" && "${gap:-0}" != "" ]]; then
      echo "$(date -Is) box resume detected (wall jumped ${gap}ms); stale-scan grace ${GRACE_MIN}m" >> "$LOG"
    fi
    if [[ "$should" == "1" ]]; then
      if restart_hung; then
        STALE_STREAK=0
        echo "$(date -Is) worker not running; starting" >> "$LOG"
        if ! "$ROOT/scripts/start-live-worker.sh" >> "$LOG" 2>&1; then
          echo "$(date -Is) start-live-worker.sh failed; retry in 30s" >> "$LOG"
          sleep 30
        fi
        sleep 5
        continue
      fi
      sleep 15
      continue
    fi
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
