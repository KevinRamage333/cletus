#!/usr/bin/env node
/**
 * Run one or more SQL files against Neon over WebSocket (this box cannot reach :5432).
 * Usage: neon-exec.mjs [--role owner|app|md|llc|backup] file.sql [...]
 * Never prints connection strings or passwords.
 */
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
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const roleKey = (() => {
  const i = process.argv.indexOf('--role');
  return (i >= 0 ? process.argv[i + 1] : 'owner') || 'owner';
})();
const urlMap = {
  owner: env.NEON_OWNER_DATABASE_URL,
  app: env.DATABASE_URL,
  md: env.MARKET_DATA_DATABASE_URL,
  llc: env.LLC_DATABASE_URL,
  backup: env.BACKUP_DATABASE_URL,
};
const url = urlMap[roleKey];
if (!url) { console.error(`neon-exec: no url for role ${roleKey}`); process.exit(1); }

const files = process.argv.slice(2).filter((a, i, arr) => a !== '--role' && arr[i - 1] !== '--role');
if (!files.length) { console.error('usage: neon-exec.mjs [--role owner|app|md|llc|backup] file.sql ...'); process.exit(1); }

const pool = new Pool({ connectionString: url });
try {
  for (const f of files) {
    const sql = readFileSync(f, 'utf8');
    await pool.query(sql);
    console.log('applied', f, 'as', roleKey);
  }
} catch (e) {
  console.error('neon-exec failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
