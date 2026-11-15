#!/usr/bin/env bash
# Ensure the local Neon HTTP-CONNECT tunnel is running on 127.0.0.1:15432.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/logs/neon-tunnel.pid"
LOG="$ROOT/logs/neon-tunnel.log"
mkdir -p "$ROOT/logs"
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  if bash -c 'echo >/dev/tcp/127.0.0.1/15432' 2>/dev/null; then
    exit 0
  fi
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  sleep 0.2
fi
nohup python3 "$ROOT/scripts/neon-proxy-tunnel.py" >> "$LOG" 2>&1 &
echo $! > "$PIDFILE"
# wait briefly for the listen socket
for i in 1 2 3 4 5 6 7 8 9 10; do
  if bash -c 'echo >/dev/tcp/127.0.0.1/15432' 2>/dev/null; then
    echo "neon tunnel pid $(cat "$PIDFILE") on 127.0.0.1:15432"
    exit 0
  fi
  sleep 0.2
done
echo "ensure-neon-tunnel: listen socket did not come up" >&2
exit 1
