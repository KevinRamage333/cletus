/**
 * One budgeted whale-flow pass over the most recently backfilled pools (for testing / seeding history without the app).
 *   npx tsx --env-file=.env.local scripts/whales/collect-once.ts [--pools 5]
 * Costs ≈ 10 Helius credits per pool (+ ≤ 8 for fresh-wallet checks). Places no trades.
 */
import pg from 'pg';
import { whaleTick, flowStatus, whaleActivity, type FlowTarget } from '../../src/lib/flow-collector';
const n = Number(process.argv[process.argv.indexOf('--pools') + 1]) || 5;
(async () => {
  const u = new URL(process.env.MARKET_DATA_DATABASE_URL!); u.searchParams.delete('sslmode');
  const db = new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } }); await db.connect();
  const r = await db.query(`select p.address, p.base_mint, p.base_symbol, s.price_usd, s.reserve_usd from market_data.pools p join lateral (select * from market_data.pool_snapshots s where s.pool = p.address order by taken_at desc limit 1) s on true
    where s.mcap_usd between 250000 and 50000000 order by s.reserve_usd desc nulls last limit $1`, [n]);
  await db.end();
  const t: FlowTarget[] = r.rows.map((x) => ({ mint: x.base_mint, pool: x.address, symbol: x.base_symbol, priceUsd: Number(x.price_usd), liquidityUsd: x.reserve_usd ? Number(x.reserve_usd) : null, creator: null, position: false, buyRatio5m: null, priceChangeH1: 0, priceChangeM5: 0 }));
  await whaleTick(Date.now(), t);
  console.log(JSON.stringify(flowStatus()));
  for (const x of t) { const a = await whaleActivity({ mint: x.mint }); console.log(a.found ? (a as any).summary : `${x.symbol}: no data`); }
  process.exit(0);
})();
