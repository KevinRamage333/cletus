#!/usr/bin/env bash
# Stop the box live worker (whole process group, then any leftover
# scripts/live-worker.ts processes). Does not automatically sell an open position.
# To close positions first, use the owner sell-all / kill switch, then run this.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/live-worker-ctl.sh
source "$ROOT/scripts/live-worker-ctl.sh"
cletus_ctl_init
if ! worker_is_running && [[ ! -f "$PIDFILE" ]]; then
  echo "no live worker process found"
  rm -f "$PIDFILE" "$METAFILE" "$LOG_DIR/live-worker.pgid"
  exit 0
fi
pids="$(list_worker_pids | tr '\n' ' ')"
stop_live_worker
echo "stopped live worker pids ${pids}"
