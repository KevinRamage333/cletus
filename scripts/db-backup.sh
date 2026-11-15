#!/usr/bin/env bash
# Nightly encrypted Postgres backup for Cletus (see docs/DATABASE_PLAN.md).
#   pg_dump (custom format, whole `cletus` DB: app + llc_records + market_data)
#   -> age-encrypted to the public recipient(s) in $BACKUP_AGE_RECIPIENTS
#   -> $BACKUP_DIR/{daily,weekly,monthly}/cletus-<UTC stamp>.dump.age (+ .sha256)
# Retention: 7 daily, 4 weekly (Sunday runs), 6 monthly (1st-of-month runs).
# Optional off-box copy: BACKUP_OFFSITE_CMD='oci os object put -bn cletus-backups --file' (file path appended).
# Connects as the read-only cletus_backup role over SSL. Never prints credentials.
# Cron (02:15 America/Chicago): see docs/BOX_RESTORE.md
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=${ENV_FILE:-.env.local}
BACKUP_DIR=${BACKUP_DIR:-$HOME/cletus-backups}
RECIPIENTS=${BACKUP_AGE_RECIPIENTS:-.secrets/backup-age.pub}
KEEP_DAILY=${KEEP_DAILY:-7}; KEEP_WEEKLY=${KEEP_WEEKLY:-4}; KEEP_MONTHLY=${KEEP_MONTHLY:-6}

[ -s "$RECIPIENTS" ] || { echo "no age recipients file at $RECIPIENTS" >&2; exit 1; }
URL=$(grep -E '^BACKUP_DATABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')
[ -n "$URL" ] || { echo "BACKUP_DATABASE_URL missing in $ENV_FILE" >&2; exit 1; }
# postgresql://user:pass@host:port/db?...  -> libpq env vars (keeps the password out of argv / ps)
rest=${URL#*://}; creds=${rest%%@*}; hostpart=${rest#*@}
export PGUSER=${creds%%:*} PGPASSWORD=${creds#*:}
hp=${hostpart%%/*}; export PGHOST=${hp%%:*} PGPORT=${hp##*:}
db=${hostpart#*/}; export PGDATABASE=${db%%\?*} PGSSLMODE=require
unset URL creds rest

umask 077
mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}; chmod 700 "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/daily/cletus-$STAMP.dump.age"
TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT

if [[ "${PGHOST:-}" == *neon.tech* ]] || [[ "${BACKUP_DATABASE_URL:-}" == *neon.tech* ]]; then
  export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:8791}"
  export NEON_HTTPS_PROXY="${NEON_HTTPS_PROXY:-$HTTPS_PROXY}"
  # Neon from this box cannot use libpq :5432; dump over WebSocket as SQL, then encrypt.
  node scripts/neon-backup-dump.mjs | gzip -c | age --encrypt -R "$RECIPIENTS" -o "$TMP"
else
  pg_dump --format=custom --compress=6 --no-password | age --encrypt -R "$RECIPIENTS" -o "$TMP"
fi
[ "$(stat -c %s "$TMP")" -gt 512 ] || { echo "backup suspiciously small" >&2; exit 1; }
mv "$TMP" "$OUT"
( cd "$(dirname "$OUT")" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )

copy_tier() { cp "$OUT" "$BACKUP_DIR/$1/"; cp "$OUT.sha256" "$BACKUP_DIR/$1/"; }
if [ "$(date +%u)" = 7 ] || [ "${FORCE_WEEKLY:-0}" = 1 ]; then copy_tier weekly; fi
if [ "$(date +%d)" = 01 ] || [ "${FORCE_MONTHLY:-0}" = 1 ]; then copy_tier monthly; fi

prune() { # keep newest N in a tier
  local dir="$BACKUP_DIR/$1" keep=$2
  local f
  { ls -1t "$dir"/cletus-*.dump.age 2>/dev/null || true; } | tail -n +$((keep + 1)) | while read -r f; do rm -f "$f" "$f.sha256"; done
}
prune daily "$KEEP_DAILY"; prune weekly "$KEEP_WEEKLY"; prune monthly "$KEEP_MONTHLY"

if [ -n "${BACKUP_OFFSITE_CMD:-}" ]; then $BACKUP_OFFSITE_CMD "$OUT"; fi
echo "backup ok: $OUT ($(stat -c %s "$OUT") bytes, encrypted with age)"
