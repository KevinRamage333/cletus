/**
 * Backfill 5-minute OHLCV history from GeckoTerminal into the LLC's own market_data store
 * (tables market_data.ohlcv_5m + market_data.pool_snapshots; DDL in docs/sql/schemas.sql, created here if missing).
 *
 *   npx tsx --env-file=.env.local scripts/backtest/backfill-gecko.ts [--pools 160] [--rpm 2] [--pages 5]
 *
 * Rate limit: at most --rpm (default 2) GeckoTerminal calls per minute, spaced evenly. Resumable: pools already
 * backfilled within --fresh-hours (default 12) are skipped. Never touches the app schema or any keys.
 * Discovery is deliberately broad (trending + top-volume + NEW pools) to reduce survivorship bias; the 25 pools the live
 * collector already watched are included too.
 */
import pg from 'pg';

const GT = 'https://api.geckoterminal.com/api/v2';
const arg = (k: string, d: number) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const MAX_POOLS = arg('pools', 160), RPM = Math.min(2, arg('rpm', 2)), PAGES = arg('pages', 5), FRESH_H = arg('fresh-hours', 12);
const GAP_MS = Math.ceil(60_000 / RPM) + 250;
const SKIP_BASES = new Set(['SOL', 'WSOL', 'USDC', 'USDT', 'JUP', 'JTO', 'BONK', 'WIF', 'RAY', 'PYTH', 'JITOSOL', 'MSOL', 'BSOL', 'CBBTC', 'WBTC', 'WETH', 'USD1', 'PYUSD', 'USDS', 'TRUMP']);

let lastCall = 0, calls = 0;
async function gt(path: string): Promise<any> {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now(); calls++;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(GT + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 65_000)); lastCall = Date.now(); calls++; continue; }
    if (!res.ok) throw new Error(`GT ${res.status} ${path}`);
    return res.json();
  }
  throw new Error(`GT 429 x3 ${path}`);
}

interface PoolMeta { address: string; dex: string; baseMint: string; baseSymbol: string; quoteSymbol: string; priceUsd: number; fdvUsd: number | null; mcapUsd: number | null; reserveUsd: number | null; createdAt: string | null; source: string }
function parsePool(d: any, source: string): PoolMeta | null {
  const a = d?.attributes; if (!a) return null;
  const [baseSym, quoteSym] = String(a.name ?? '').split(' / ').map((s: string) => s.trim());
  const n = (x: any) => (x === null || x === undefined || x === '' ? null : Number(x));
  return {
    address: a.address, dex: d.relationships?.dex?.data?.id ?? 'unknown', baseMint: String(d.relationships?.base_token?.data?.id ?? '').replace(/^solana_/, ''),
    baseSymbol: baseSym ?? '', quoteSymbol: quoteSym ?? '', priceUsd: Number(a.base_token_price_usd), fdvUsd: n(a.fdv_usd), mcapUsd: n(a.market_cap_usd), reserveUsd: n(a.reserve_in_usd),
    createdAt: a.pool_created_at ?? null, source,
  };
}

async function main() {
  const u = new URL(process.env.MARKET_DATA_DATABASE_URL!); u.searchParams.delete('sslmode');
  const db = new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  await db.query(`
    create table if not exists market_data.ohlcv_5m (
      pool text not null references market_data.pools(address), bucket timestamptz not null,
      open numeric not null, high numeric not null, low numeric not null, close numeric not null, volume_usd numeric not null default 0,
      source text not null default 'geckoterminal', updated_at timestamptz not null default now(), primary key (pool, bucket));
    create table if not exists market_data.pool_snapshots (
      pool text not null references market_data.pools(address), taken_at timestamptz not null default now(),
      price_usd numeric, fdv_usd numeric, mcap_usd numeric, reserve_usd numeric, pool_created_at timestamptz, discovered_via text,
      primary key (pool, taken_at));`);

  // 1. Discovery
  const metas = new Map<string, PoolMeta>();
  const lists: Array<[string, string]> = [];
  for (let p = 1; p <= PAGES; p++) lists.push([`/networks/solana/new_pools?page=${p}`, 'new'], [`/networks/solana/trending_pools?page=${p}&duration=24h`, 'trending24h'], [`/networks/solana/pools?page=${p}&sort=h24_volume_usd_desc`, 'topvol']);
  const existing = (await db.query(`select address from market_data.pools`)).rows.map((r) => r.address as string);
  for (let i = 0; i < existing.length; i += 30) {
    try { const j = await gt(`/networks/solana/pools/multi/${existing.slice(i, i + 30).join(',')}`); for (const d of j.data ?? []) { const m = parsePool(d, 'collector'); if (m) metas.set(m.address, m); } } catch (e) { console.error(String(e)); }
  }
  for (const [path, src] of lists) {
    try { const j = await gt(path); for (const d of j.data ?? []) { const m = parsePool(d, src); if (m && !metas.has(m.address)) metas.set(m.address, m); } }
    catch (e) { console.error(String(e)); }
    console.log(`discovery ${path}: ${metas.size} pools (calls ${calls})`);
  }
  const ok = [...metas.values()].filter((m) => !SKIP_BASES.has(m.baseSymbol.toUpperCase()) && ['SOL', 'USDC', 'USDT'].includes(m.quoteSymbol.toUpperCase()) && (m.fdvUsd ?? m.mcapUsd ?? 0) >= 5_000 && (m.fdvUsd ?? m.mcapUsd ?? 0) <= 150_000_000 && m.priceUsd > 0);
  // Interleave mcap bands so all three presets get coverage.
  const band = (m: PoolMeta) => { const c = m.mcapUsd || m.fdvUsd || 0; return c < 500_000 ? 0 : c < 5_000_000 ? 1 : 2; };
  const byBand = [0, 1, 2].map((b) => ok.filter((m) => band(m) === b));
  const ordered: PoolMeta[] = [];
  const collectorFirst = ok.filter((m) => m.source === 'collector');
  ordered.push(...collectorFirst);
  for (let i = 0; ordered.length < ok.length; i++) { let added = false; for (const b of byBand) if (b[i]) { if (!ordered.includes(b[i])) ordered.push(b[i]); added = true; } if (!added) break; }
  const targets = ordered.slice(0, MAX_POOLS);
  console.log(`eligible ${ok.length} (bands degen/bal/safer by current mcap: ${byBand.map((b) => b.length).join('/')}); backfilling ${targets.length}`);

  for (const m of targets) {
    await db.query(`insert into market_data.pools (address, dex, base_mint, base_symbol, quote_symbol) values ($1,$2,$3,$4,$5) on conflict (address) do nothing`, [m.address, m.dex, m.baseMint || m.address, m.baseSymbol, m.quoteSymbol]);
    await db.query(`insert into market_data.pool_snapshots (pool, price_usd, fdv_usd, mcap_usd, reserve_usd, pool_created_at, discovered_via) values ($1,$2,$3,$4,$5,$6,$7)`, [m.address, m.priceUsd, m.fdvUsd, m.mcapUsd, m.reserveUsd, m.createdAt, m.source]);
  }

  // 2. OHLCV (5m x 1000 ≈ 3.5 days per call)
  let done = 0, rows = 0;
  for (const m of targets) {
    const fresh = await db.query(`select max(updated_at) as t, count(*) as n from market_data.ohlcv_5m where pool = $1`, [m.address]);
    if (fresh.rows[0].t && Date.now() - new Date(fresh.rows[0].t).getTime() < FRESH_H * 3_600_000 && Number(fresh.rows[0].n) > 50) { done++; continue; }
    try {
      const j = await gt(`/networks/solana/pools/${m.address}/ohlcv/minute?aggregate=5&limit=1000&currency=usd`);
      const seen = new Set<number>();
      const list: number[][] = (j?.data?.attributes?.ohlcv_list ?? []).filter((r: number[]) => !seen.has(r[0]) && seen.add(r[0])); // GT can repeat a bucket
      const vals: unknown[] = []; const tuples: string[] = [];
      list.forEach((r, i) => { const b = i * 7; tuples.push(`($${b + 1}, to_timestamp($${b + 2}), $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`); vals.push(m.address, r[0], r[1], r[2], r[3], r[4], r[5] ?? 0); });
      if (tuples.length) await db.query(`insert into market_data.ohlcv_5m (pool, bucket, open, high, low, close, volume_usd) values ${tuples.join(',')}
        on conflict (pool, bucket) do update set open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume_usd=excluded.volume_usd, updated_at=now()`, vals);
      rows += tuples.length; done++;
      console.log(`[${done}/${targets.length}] ${m.baseSymbol} ${m.address.slice(0, 6)} mcap $${Math.round(m.mcapUsd || m.fdvUsd || 0).toLocaleString()} candles ${tuples.length} (calls ${calls})`);
    } catch (e) { console.error(`${m.address}: ${String(e)}`); }
  }
  console.log(`backfill complete: ${done} pools, ${rows} candles, ${calls} GeckoTerminal calls`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
