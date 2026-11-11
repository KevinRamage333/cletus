#!/usr/bin/env bash
# Optional SQLite dev mode: derive prisma/sqlite/schema.prisma from the Postgres schema and push to dev.db.
# Usage: npm run db:sqlite   then run the app with DATABASE_URL="file:./dev.db" PRISMA_SCHEMA=sqlite
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p prisma/sqlite
sed 's/provider = "postgresql"/provider = "sqlite"/' prisma/schema.prisma > prisma/sqlite/schema.prisma
DATABASE_URL="${SQLITE_DATABASE_URL:-file:../dev.db}" npx prisma db push --schema prisma/sqlite/schema.prisma --skip-generate
DATABASE_URL="${SQLITE_DATABASE_URL:-file:../dev.db}" npx prisma generate --schema prisma/sqlite/schema.prisma
echo "SQLite client generated. Start with: DATABASE_URL=file:./dev.db npm run dev  (re-run 'npx prisma generate' to go back to Postgres)"
