#!/usr/bin/env bash
# Start the local PostgreSQL 17 cluster if it is not already listening on 127.0.0.1:5432.
# Safe to run from cron or start-live-worker.sh. No secrets.
set -euo pipefail
if command -v pg_isready >/dev/null && pg_isready -h 127.0.0.1 -p 5432 -q; then
  exit 0
fi
if ! command -v pg_ctlcluster >/dev/null; then
  echo "ensure-postgres: pg_ctlcluster not found (is postgresql-17 installed?)" >&2
  exit 1
fi
# policy-rc.d blocks service postgresql start in this container; pg_ctlcluster talks to the cluster directly.
if sudo -n pg_ctlcluster 17 main status >/dev/null 2>&1; then
  echo "ensure-postgres: cluster reports down; starting"
fi
sudo -n pg_ctlcluster 17 main start
pg_isready -h 127.0.0.1 -p 5432 -q
