#!/usr/bin/env bash
# Create (or re-key) the Cletus Postgres roles, database and schemas, then apply docs/sql/schemas.sql.
# Generates role passwords on first run and stores them ONLY in .env.local (chmod 600). Never prints them.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=.env.local
touch "$ENV"; chmod 600 "$ENV"
getv() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- || true; }
setv() { # replace or append KEY=VALUE without echoing it
  local k="$1" v="$2" tmp; tmp=$(mktemp); grep -vE "^$k=" "$ENV" > "$tmp" || true
  printf '%s=%s\n' "$k" "$v" >> "$tmp"; cat "$tmp" > "$ENV"; rm -f "$tmp"; chmod 600 "$ENV"; }
gen() { openssl rand -hex 24; }
for k in CLETUS_APP_PW CLETUS_MD_PW CLETUS_LLC_PW CLETUS_BACKUP_PW; do
  [ -n "$(getv $k)" ] || setv "$k" "$(gen)"
done
export CLETUS_APP_PW="$(getv CLETUS_APP_PW)" CLETUS_MD_PW="$(getv CLETUS_MD_PW)" \
       CLETUS_LLC_PW="$(getv CLETUS_LLC_PW)" CLETUS_BACKUP_PW="$(getv CLETUS_BACKUP_PW)"
HOST=${PGHOST_CLETUS:-127.0.0.1}
setv DATABASE_URL "postgresql://cletus_app:${CLETUS_APP_PW}@${HOST}:5432/cletus?schema=app&sslmode=require"
setv MARKET_DATA_DATABASE_URL "postgresql://cletus_md:${CLETUS_MD_PW}@${HOST}:5432/cletus?sslmode=require"
setv LLC_DATABASE_URL "postgresql://cletus_llc:${CLETUS_LLC_PW}@${HOST}:5432/cletus?sslmode=require"
setv BACKUP_DATABASE_URL "postgresql://cletus_backup:${CLETUS_BACKUP_PW}@${HOST}:5432/cletus?sslmode=require"
# psql runs as the OS postgres user (peer auth over the unix socket); env passes through sudo -E.
export PGOPTIONS='-c client_min_messages=warning'
sudo -E -u postgres psql -q -X -f scripts/db-init.sql
sudo -E -u postgres psql -q -X -d cletus -v ON_ERROR_STOP=1 -f docs/sql/schemas.sql
echo "db-init: roles, database 'cletus', schemas app/market_data/llc_records ready (secrets in $ENV only)"
