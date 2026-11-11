// One-shot copy of the dev SQLite database (prisma/dev.db) into the Postgres `app` schema.
// Usage: node --env-file=.env.local scripts/sqlite-to-postgres.mjs [--truncate]
// Reads DATABASE_URL (Postgres, cletus_app). Prints only table names and row counts.
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const SRC = process.env.SQLITE_PATH || 'prisma/dev.db';
const url = new URL(process.env.DATABASE_URL);
if (!url.protocol.startsWith('postgres')) throw new Error('DATABASE_URL is not Postgres');
const schema = url.searchParams.get('schema') || 'app';
url.searchParams.delete('schema');
url.searchParams.delete('sslmode');
const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
const src = new DatabaseSync(SRC, { readOnly: true });
await client.connect();

const { rows: cols } = await client.query(
  `select table_name, column_name, data_type from information_schema.columns where table_schema=$1`, [schema]);
const types = {};
for (const c of cols) (types[c.table_name] ??= {})[c.column_name] = c.data_type;
const { rows: fks } = await client.query(
  `select tc.table_name child, ccu.table_name parent from information_schema.table_constraints tc
   join information_schema.constraint_column_usage ccu on tc.constraint_name=ccu.constraint_name and tc.table_schema=ccu.table_schema
   where tc.constraint_type='FOREIGN KEY' and tc.table_schema=$1`, [schema]);

const tables = Object.keys(types).filter((t) => t !== '_prisma_migrations');
const order = []; const seen = new Set();
const visit = (t) => { if (seen.has(t)) return; seen.add(t);
  for (const f of fks) if (f.child === t && f.parent !== t) visit(f.parent); order.push(t); };
tables.forEach(visit);

const conv = (v, type) => {
  if (v === null || v === undefined) return null;
  if (type?.startsWith("timestamp")) return new Date(typeof v === 'bigint' ? Number(v) : (/^\d+$/.test(String(v)) ? Number(v) : v)).toISOString(); // UTC, as Prisma stores it
  if (type === 'boolean') return v === 1 || v === 1n || v === true || v === 'true';
  if (typeof v === 'bigint') return v.toString();
  return v;
};

await client.query('begin');
if (process.argv.includes('--truncate'))
  await client.query(`truncate ${order.map((t) => `"${schema}"."${t}"`).join(', ')} cascade`);
for (const t of order) {
  let rows;
  try { rows = src.prepare(`select * from "${t}"`).all(); } catch { console.log(`${t}: not in sqlite, skipped`); continue; }
  const colNames = Object.keys(types[t]);
  let n = 0;
  for (const r of rows) {
    const present = colNames.filter((c) => c in r);
    const vals = present.map((c) => conv(r[c], types[t][c]));
    await client.query(
      `insert into "${schema}"."${t}" (${present.map((c) => `"${c}"`).join(',')}) values (${present.map((_, i) => `$${i + 1}`).join(',')}) on conflict do nothing`, vals);
    n++;
  }
  console.log(`${t}: ${n} rows`);
}
await client.query('commit');
await client.end();
