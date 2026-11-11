/**
 * Owner: add (or remove) a watched wallet.
 *   npx tsx --env-file=.env.local scripts/whales/add-wallet.ts <address> [label] [--kind manual|smart|insider] [--mint <mint>] [--remove]
 * Wallets can also be listed in WATCHED_WALLETS="addr:label,addr2:label2".
 */
import pg from 'pg';
import { FLOW_DDL } from '../../src/lib/flow-collector';
const a = process.argv.slice(2); const flag = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
const pos = a.filter((x, i) => !x.startsWith('--') && !a[i - 1]?.startsWith('--'));
const [address, label] = pos; const kind = flag('kind') ?? 'manual'; const mint = flag('mint') ?? '';
if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) { console.error('usage: add-wallet.ts <solana address> [label] [--kind manual|smart|insider] [--mint <mint>] [--remove]'); process.exit(1); }
const u = new URL(process.env.MARKET_DATA_DATABASE_URL!); u.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });
(async () => {
await db.connect(); await db.query(FLOW_DDL);
if (a.includes('--remove')) { await db.query(`delete from market_data.watched_wallets where address=$1 and kind=$2 and mint=$3`, [address, kind, mint]); console.log(`removed ${address}`); }
else { await db.query(`insert into market_data.watched_wallets (address, kind, mint, label, source) values ($1,$2,$3,$4,'owner') on conflict (address, kind, mint) do update set label = excluded.label`, [address, kind, mint, label ?? 'owner']); console.log(`watching ${address} (${kind}) https://solscan.io/account/${address}`); }
await db.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
