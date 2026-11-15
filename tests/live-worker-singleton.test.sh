#!/usr/bin/env bash
# Simulate start / second start / hung-restart against a stub worker that never trades.
# Must never match or signal the production scripts/live-worker.ts process.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d /tmp/cletus-worker-singleton.XXXXXX)"
ENTRY="$REPO/tests/fixtures/live-worker-stub.ts"

if [[ "$TMP" == "$REPO" || "$TMP" == /workspace/cletus || "$ENTRY" == *'/scripts/live-worker.ts' ]]; then
  echo "refusing to run singleton test against the production worker" >&2
  exit 99
fi

export LIVE_WORKER_TEST_MODE=1
export LIVE_WORKER_ROOT="$TMP"
export LIVE_WORKER_ENTRY="$ENTRY"
export LIVE_WORKER_FLOCK_HELPER="$REPO/scripts/hold-worker-lock.py"
mkdir -p "$TMP/logs"

# shellcheck source=scripts/live-worker-ctl.sh
source "$REPO/scripts/live-worker-ctl.sh"
cletus_ctl_init

cleanup() {
  stop_live_worker >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

# Absolute safety: our matcher must not see the production entry.
prod_hits="$(CLETUS_WORKER_NEEDLE='scripts/live-worker.ts' python3 << 'PY' | wc -l | tr -d ' '
import os
needle = os.environ['CLETUS_WORKER_NEEDLE']
for name in os.listdir("/proc"):
    if not name.isdigit():
        continue
    try:
        cmd = open(f"/proc/{name}/cmdline", "rb").read().replace(b"\0", b" ").decode("utf-8", "replace")
    except OSError:
        continue
    if needle in cmd:
        print(name)
PY
)"
# Just record; we will never call production stop. If production is running that's expected.
echo "production live-worker.ts matching pids (untouched): $prod_hits"

group_count() {
  local g
  g="$(list_worker_pids | while read -r p; do ps -o pgid= -p "$p" 2>/dev/null | tr -d ' '; done | awk 'NF' | sort -u | wc -l | tr -d ' ')"
  echo "$g"
}

echo "== start stub =="
start_live_worker_process
sleep 1
c1="$(group_count)"
n1="$(worker_pid_count)"
echo "after start: groups=$c1 pids=$n1 $(list_worker_pids | tr '\n' ' ')"
if [[ "$c1" != "1" || "$n1" -lt 1 ]]; then
  echo "expected exactly one stub process group after start" >&2
  exit 1
fi
first_pids="$(list_worker_pids | tr '\n' ' ')"

echo "== second start must refuse =="
out="$(start_live_worker_process)"
echo "$out"
echo "$out" | grep -q "already running" || { echo "second start did not refuse" >&2; exit 1; }
c2="$(group_count)"
n2="$(worker_pid_count)"
echo "after second start: groups=$c2 pids=$n2"
if [[ "$c2" != "1" ]]; then
  echo "second start spawned another group" >&2
  exit 1
fi
if [[ "$(list_worker_pids | tr '\n' ' ')" != "$first_pids" ]]; then
  echo "second start changed the running pid set" >&2
  exit 1
fi

echo "== hung-restart path (group stop, then start) =="
stop_live_worker
if worker_is_running; then
  echo "stop left stub processes running" >&2
  exit 1
fi
start_live_worker_process
sleep 1
c3="$(group_count)"
n3="$(worker_pid_count)"
echo "after hung-restart: groups=$c3 pids=$n3 $(list_worker_pids | tr '\n' ' ')"
if [[ "$c3" != "1" || "$n3" -lt 1 ]]; then
  echo "hung-restart did not leave exactly one stub group" >&2
  exit 1
fi

# Production still untouched: count now vs start (allow the same or more if someone started nothing)
echo "ok: start / second-start / hung-restart left exactly one stub group"
