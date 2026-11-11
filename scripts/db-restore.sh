#!/usr/bin/env bash
# Restore an age-encrypted Cletus backup.
#   scripts/db-restore.sh <file.dump.age> [target_db]        (default target: cletus_restore_test)
#   scripts/db-restore.sh <file.dump.age> cletus --force      (overwrite the live DB: stop the app first!)
# Options: --keep  keep the scratch DB after verification (default: drop it if target is cletus_restore_test)
# Needs the age identity (private key) at $BACKUP_AGE_IDENTITY (default .secrets/backup-age.key; keep it OFF the
# server in production and bring it only for restores). Runs pg_restore as the postgres superuser over the local socket.
# Roles must already exist in the cluster (scripts/db-init.sh) so ownership and grants restore correctly.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE=${1:?usage: db-restore.sh <file.dump.age> [target_db] [--force] [--keep]}
TARGET=${2:-cletus_restore_test}; [[ "$TARGET" == --* ]] && TARGET=cletus_restore_test
FORCE=0; KEEP=0; for a in "$@"; do [ "$a" = --force ] && FORCE=1; [ "$a" = --keep ] && KEEP=1; done
IDENTITY=${BACKUP_AGE_IDENTITY:-.secrets/backup-age.key}
PSQL="sudo -u postgres psql -X -q -t -A -v ON_ERROR_STOP=1"

[ -f "$FILE" ] || { echo "no such backup: $FILE" >&2; exit 1; }
if [ -f "$FILE.sha256" ]; then ( cd "$(dirname "$FILE")" && sha256sum -c --quiet "$(basename "$FILE").sha256" ) && echo "checksum ok"; fi
if [ "$TARGET" = cletus ] && [ "$FORCE" != 1 ]; then echo "refusing to overwrite the live 'cletus' DB without --force" >&2; exit 1; fi

$PSQL -c "DROP DATABASE IF EXISTS \"$TARGET\" WITH (FORCE)"
$PSQL -c "CREATE DATABASE \"$TARGET\""
$PSQL -d "$TARGET" -c "REVOKE ALL ON SCHEMA public FROM PUBLIC"
age --decrypt -i "$IDENTITY" "$FILE" | sudo -u postgres pg_restore --exit-on-error --dbname="$TARGET"
if [ "$TARGET" != cletus ]; then
  $PSQL -c "REVOKE ALL ON DATABASE \"$TARGET\" FROM PUBLIC"
fi

echo "restored into $TARGET; row counts:"
$PSQL -d "$TARGET" -c "
  SELECT n.nspname||'.'||c.relname||': '||(xpath('/row/n/text()', query_to_xml(format('select count(*) n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p') AND n.nspname IN ('app','llc_records','market_data') AND NOT c.relispartition
  ORDER BY 1"

if [ "$TARGET" = cletus_restore_test ] && [ "$KEEP" != 1 ]; then
  $PSQL -c "DROP DATABASE \"$TARGET\" WITH (FORCE)"; echo "scratch DB dropped (use --keep to inspect)"
fi
