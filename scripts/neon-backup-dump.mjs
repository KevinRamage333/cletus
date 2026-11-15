#!/usr/bin/env node
/** Plain-SQL data+schema dump of app/market_data/llc_records over Neon WebSockets. Writes to stdout. */
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const proxy = process.env.HTTPS_PROXY || process.env.NEON_HTTPS_PROXY || 'http://127.0.0.1:8791';
neonConfig.webSocketConstructor = class extends ws {
  constructor(url, protocols) { super(url, protocols, { agent: new HttpsProxyAgent(proxy) }); }
};
const envPath = resolve(process.cwd(), '.secrets/neon-urls.env');
const env = Object.fromEntries(readFileSync(envPath, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)];
}));
// Prefer the read-only backup role; fall back to owner if grants aren't enough for some catalogs.
const url = process.env.BACKUP_DATABASE_URL || env.BACKUP_DATABASE_URL || env.NEON_OWNER_DATABASE_URL;
if (!url) { console.error('neon-backup-dump: no backup url'); process.exit(1); }
const pool = new Pool({ connectionString: url });
const schemas = ['app', 'market_data', 'llc_records'];
function qIdent(n) { return '"' + String(n).replaceAll('"', '""') + '"'; }
function qLit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return "'" + v.toISOString().replaceAll("'", "''") + "'";
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return "'" + JSON.stringify(v).replaceAll("'", "''") + "'";
  return "'" + String(v).replaceAll("'", "''") + "'";
}
try {
  process.stdout.write('-- cletus neon sql dump ' + new Date().toISOString() + '\nBEGIN;\n');
  const tables = await pool.query(`
    SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = ANY($1) AND NOT c.relispartition
    ORDER BY 1,2`, [schemas]);
  for (const t of tables.rows) {
    const fq = `${qIdent(t.schema)}.${qIdent(t.name)}`;
    const rows = await pool.query(`SELECT * FROM ${fq}`);
    process.stdout.write(`-- ${t.schema}.${t.name} (${rows.rowCount} rows)\n`);
    if (!rows.rowCount) continue;
    const cols = rows.fields.map((f) => qIdent(f.name));
    for (const row of rows.rows) {
      const vals = rows.fields.map((f) => qLit(row[f.name]));
      process.stdout.write(`INSERT INTO ${fq} (${cols.join(',')}) VALUES (${vals.join(',')});\n`);
    }
  }
  process.stdout.write('COMMIT;\n');
} catch (e) {
  console.error('neon-backup-dump failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
