#!/usr/bin/env bash
# Shared start/stop/guard helpers for the box live worker.
# Sourced by start-live-worker.sh, stop-live-worker.sh, and supervise-live-worker.sh.
# Do not exec this file as the production worker itself.
#
# Override (tests only, with LIVE_WORKER_TEST_MODE=1): LIVE_WORKER_ROOT, LIVE_WORKER_ENTRY,
# LIVE_WORKER_PIDFILE, LIVE_WORKER_LOCK, LIVE_WORKER_LOG, LIVE_WORKER_META.
set +e
# Callers use set -euo pipefail; functions below are written to be safe under those flags.

cletus_ctl_init() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  CTL_REPO_ROOT="$here"
  if [[ "${LIVE_WORKER_TEST_MODE:-}" == "1" ]]; then
    if [[ -z "${LIVE_WORKER_ROOT:-}" ]]; then
      echo "LIVE_WORKER_TEST_MODE=1 requires LIVE_WORKER_ROOT" >&2
      return 1
    fi
    ROOT="$(cd "$LIVE_WORKER_ROOT" && pwd)"
    ENTRY="${LIVE_WORKER_ENTRY:-}"
    case "$ENTRY" in
      *live-worker-stub.ts|*live-worker-stub.js) ;;
      *)
        echo "LIVE_WORKER_TEST_MODE refuses entry '$ENTRY' (must be a live-worker-stub)" >&2
        return 1
        ;;
    esac
    if [[ "$ROOT" == "$CTL_REPO_ROOT" ]]; then
      echo "LIVE_WORKER_TEST_MODE refuses to use the production repo root as ROOT" >&2
      return 1
    fi
  else
    ROOT="${LIVE_WORKER_ROOT:-$here}"
    ENTRY="${LIVE_WORKER_ENTRY:-$ROOT/scripts/live-worker.ts}"
    if [[ -n "${LIVE_WORKER_ENTRY:-}" ]]; then
      echo "LIVE_WORKER_ENTRY override refused outside LIVE_WORKER_TEST_MODE=1" >&2
      return 1
    fi
    ENTRY="$ROOT/scripts/live-worker.ts"
  fi
  LOG_DIR="${LIVE_WORKER_LOG_DIR:-$ROOT/logs}"
  mkdir -p "$LOG_DIR"
  PIDFILE="${LIVE_WORKER_PIDFILE:-$LOG_DIR/live-worker.pid}"
  LOCKFILE="${LIVE_WORKER_LOCK:-$LOG_DIR/live-worker.lock}"
  METAFILE="${LIVE_WORKER_META:-$LOG_DIR/live-worker.meta}"
  WORKER_LOG="${LIVE_WORKER_LOG:-$LOG_DIR/live-worker.log}"
  # Match the entry path as it appears in /proc/cmdline (absolute or scripts/live-worker.ts).
  if [[ "${LIVE_WORKER_TEST_MODE:-}" == "1" ]]; then
    CTL_PATTERN="$ENTRY"
  else
    CTL_PATTERN='scripts/live-worker.ts'
  fi
}

# Print PIDs whose cmdline contains the worker entry, excluding rg/grep/editors.
list_worker_pids() {
  # Pass the needle via env (not argv) so this python's own cmdline cannot match the entry path.
  CLETUS_WORKER_NEEDLE="$CTL_PATTERN" python3 << 'PY'
import os
needle = os.environ.get("CLETUS_WORKER_NEEDLE") or ""
me = os.getpid()
skip = ("rg", "grep", "less", "vi", "vim", "nano", "tail", "code", "emacs")
pids = []
for name in os.listdir("/proc"):
    if not name.isdigit():
        continue
    pid = int(name)
    if pid == me:
        continue
    try:
        raw = open(f"/proc/{pid}/cmdline", "rb").read()
    except OSError:
        continue
    if not raw:
        continue
    cmd = raw.replace(b"\0", b" ").decode("utf-8", "replace")
    if needle not in cmd:
        continue
    argv0 = cmd.split()[0] if cmd.split() else ""
    base = os.path.basename(argv0)
    if base in skip:
        continue
    pids.append(pid)
for p in pids:
    print(p)
PY
}

worker_is_running() {
  local pids
  pids="$(list_worker_pids || true)"
  [[ -n "${pids//[$'\n' ]/}" ]]
}

worker_pid_count() {
  list_worker_pids | awk 'NF' | wc -l | tr -d ' '
}

read_worker_pgid() {
  if [[ -f "$METAFILE" ]]; then
    awk -F= '/^pgid=/{print $2; exit}' "$METAFILE" 2>/dev/null || true
  fi
}

write_worker_meta() {
  local leader="$1"
  local pgid node_pid
  pgid="$(ps -o pgid= -p "$leader" 2>/dev/null | tr -d ' ' || true)"
  node_pid=""
  # Prefer a node process in the group whose cmdline contains the entry.
  local p
  while read -r p; do
    [[ -z "$p" ]] && continue
    local cmd=""
    cmd="$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null || true)"
    case "$cmd" in
      *node*"$CTL_PATTERN"*|*node*"${ENTRY}"*)
        # Prefer the actual script runner (tsx loader / --import) over npm wrappers.
        if [[ "$cmd" == *"--import"* || "$cmd" == *"tsx/dist/loader"* || "$cmd" == *"preflight"* ]]; then
          node_pid="$p"
          break
        fi
        if [[ -z "$node_pid" ]]; then node_pid="$p"; fi
        ;;
    esac
  done < <(list_worker_pids)
  umask 077
  {
    echo "pid=$leader"
    echo "pgid=${pgid:-}"
    echo "node_pid=${node_pid:-}"
  } > "$METAFILE"
  echo "$leader" > "$PIDFILE"
  if [[ -n "$pgid" ]]; then
    echo "$pgid" > "$LOG_DIR/live-worker.pgid"
  fi
}

# SIGTERM the process group only when this worker is its setsid session leader
# (pid == pgid). Legacy launches shared a group with the supervisor and other
# jobs — those are stopped by matching live-worker pids only, never the whole group.
stop_live_worker() {
  local pgid leader p leftover
  leader=""
  if [[ -f "$PIDFILE" ]]; then
    leader="$(cat "$PIDFILE" 2>/dev/null || true)"
  fi
  pgid="$(read_worker_pgid)"
  if [[ -z "$pgid" && -n "$leader" ]]; then
    pgid="$(ps -o pgid= -p "$leader" 2>/dev/null | tr -d ' ' || true)"
  fi

  if [[ -n "$pgid" && -n "$leader" && "$pgid" == "$leader" ]]; then
    # New-style setsid launch: the worker owns this group.
    kill -TERM -- "-$pgid" 2>/dev/null || true
  fi

  # Always TERM matching worker pids (covers legacy shared groups and orphans).
  while read -r p; do
    [[ -z "$p" ]] && continue
    kill -TERM "$p" 2>/dev/null || true
  done < <(list_worker_pids)

  local i
  for i in $(seq 1 40); do
    leftover="$(list_worker_pids || true)"
    if [[ -z "${leftover//[$'\n' ]/}" ]]; then
      rm -f "$PIDFILE" "$METAFILE" "$LOG_DIR/live-worker.pgid"
      return 0
    fi
    sleep 0.25
  done

  leftover="$(list_worker_pids || true)"
  if [[ -n "$pgid" && -n "$leader" && "$pgid" == "$leader" ]]; then
    kill -KILL -- "-$pgid" 2>/dev/null || true
  fi
  while read -r p; do
    [[ -z "$p" ]] && continue
    kill -KILL "$p" 2>/dev/null || true
  done <<< "$leftover"
  sleep 0.2
  leftover="$(list_worker_pids || true)"
  rm -f "$PIDFILE" "$METAFILE" "$LOG_DIR/live-worker.pgid"
  if [[ -n "${leftover//[$'\n' ]/}" ]]; then
    echo "stop_live_worker: still running: $leftover" >&2
    return 1
  fi
  return 0
}

refuse_if_worker_running() {
  if worker_is_running; then
    local pids
    pids="$(list_worker_pids | tr '\n' ' ')"
    echo "live worker already running pids ${pids}"
    # Refresh pidfile if it is missing or stale so the supervisor can adopt the tree.
    local first
    first="$(list_worker_pids | awk 'NF{print; exit}')"
    if [[ -n "$first" ]]; then
      if [[ ! -f "$PIDFILE" ]] || ! kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
        write_worker_meta "$first"
      fi
    fi
    return 0
  fi
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "live worker already running pid $(cat "$PIDFILE")"
    return 0
  fi
  return 1
}

# Launch $ENTRY (or the production live-worker.ts) in its own session/process group.
start_live_worker_process() {
  if refuse_if_worker_running; then
    return 0
  fi
  local cmd
  mkdir -p "$LOG_DIR"
  if [[ "${LIVE_WORKER_TEST_MODE:-}" == "1" ]]; then
    # Stub only: no trading env, no production .env.local, isolated ROOT.
    export LIVE_WORKER_LOCK="$LOCKFILE"
    export LIVE_WORKER_ROOT="$ROOT"
    export LIVE_WORKER_ENTRY="$ENTRY"
    # Copy the flock helper so the stub can find it under a test ROOT, or point at the repo copy.
    export LIVE_WORKER_FLOCK_HELPER="${LIVE_WORKER_FLOCK_HELPER:-$CTL_REPO_ROOT/scripts/hold-worker-lock.py}"
    local tsx_bin="${CTL_REPO_ROOT}/node_modules/.bin/tsx"
    if [[ ! -x "$tsx_bin" ]]; then
      echo "tsx not found at $tsx_bin" >&2
      return 1
    fi
    setsid -- "$tsx_bin" "$ENTRY" >> "$WORKER_LOG" 2>&1 < /dev/null &
  else
    # shellcheck disable=SC2086
    setsid -- npx tsx --env-file=.env.local "$ENTRY" >> "$WORKER_LOG" 2>&1 < /dev/null &
  fi
  local leader=$!
  # Give tsx a moment to spawn the real node process, then record leader/pgid/node pid.
  sleep 0.4
  write_worker_meta "$leader"
  echo "started live worker pid $leader pgid $(read_worker_pgid) log $WORKER_LOG"
  return 0
}
