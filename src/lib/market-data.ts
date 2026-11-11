// market_data collector: stores 1-minute candles for open positions + top scanner picks in the
// Postgres `market_data` schema (role cletus_md), via the GeckoTerminal OHLCV API (shared rate limit).
// It's a stepping stone to the Helius-stream indexer in docs/DATABASE_PLAN.md. Off unless MARKET_DATA_DATABASE_URL is set.
import type { Candle } from './gecko';

export interface WatchPool { pool: string; mint: string; symbol?: string; quote?: string; dex?: string; reason: 'position' | 'scanner' }
export interface CollectorStatus { enabled: boolean; running: boolean; ticks: number; pools: number; candlesWritten: number; lastTickAt: string | null; lastError: string | null; rateLimited: number }

type MdState = { lastPolled: Map<string, number>; status: CollectorStatus; timer?: NodeJS.Timeout };
const g = globalThis as unknown as { __mdState?: MdState; __mdPool?: import('pg').Pool };
const state: MdState = (g.__mdState ??= {
  lastPolled: new Map(),
  status: { enabled: false, running: false, ticks: 0, pools: 0, candlesWritten: 0, lastTickAt: null, lastError: null, rateLimited: 0 },
});

const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
export const collectorOpts = () => ({
  tickMs: num('MARKET_DATA_TICK_SECONDS', 60) * 1000,
  perTick: num('MARKET_DATA_POOLS_PER_TICK', 2),          // ≤ 2 GeckoTerminal calls/min by default
  poolIntervalMs: num('MARKET_DATA_POOL_INTERVAL_SECONDS', 300) * 1000,
  maxPools: num('MARKET_DATA_MAX_POOLS', 20),
  limit: Math.min(1000, num('MARKET_DATA_CANDLES_PER_FETCH', 100)),
});
export const collectorEnabled = () => !!process.env.MARKET_DATA_DATABASE_URL && process.env.MARKET_DATA_COLLECTOR !== 'off';

/** Watch list: open positions first, then the best non-rejected scanner candidates; de-duplicated, capped. Pure. */
export function watchList(
  positions: Array<{ pairAddress: string | null; mint: string; symbol: string }>,
  candidates: Array<{ pairAddress?: string; mint: string; symbol: string; quoteSymbol?: string; dexId?: string; composite: number; rejected?: string }>,
  maxPools: number,
): WatchPool[] {
  const out = new Map<string, WatchPool>();
  for (const p of positions) if (p.pairAddress && !out.has(p.pairAddress)) out.set(p.pairAddress, { pool: p.pairAddress, mint: p.mint, symbol: p.symbol, reason: 'position' });
  const ranked = [...candidates].filter((c) => c.pairAddress && !c.rejected).sort((a, b) => b.composite - a.composite);
  for (const c of ranked) {
    if (out.size >= maxPools) break;
    if (!out.has(c.pairAddress!)) out.set(c.pairAddress!, { pool: c.pairAddress!, mint: c.mint, symbol: c.symbol, quote: c.quoteSymbol, dex: c.dexId, reason: 'scanner' });
  }
  return [...out.values()].slice(0, Math.max(maxPools, positions.length));
}

/** Which pools to poll this tick: due ones (not polled within intervalMs), positions first, then least-recently polled. Pure. */
export function duePools(list: WatchPool[], lastPolled: Map<string, number>, now: number, perTick: number, intervalMs: number): WatchPool[] {
  return list
    .filter((w) => now - (lastPolled.get(w.pool) ?? 0) >= intervalMs)
    .sort((a, b) => Number(b.reason === 'position') - Number(a.reason === 'position') || (lastPolled.get(a.pool) ?? 0) - (lastPolled.get(b.pool) ?? 0))
    .slice(0, perTick);
}

/** Build a single multi-row upsert for candles. Exported for tests. */
export function candleUpsertSql(pool: string, candles: Candle[], source = 'geckoterminal') {
  const values: unknown[] = []; const rows: string[] = [];
  candles.forEach((c, i) => {
    const b = i * 8;
    rows.push(`($${b + 1}, to_timestamp($${b + 2}), $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`);
    values.push(pool, c.time, c.open, c.high, c.low, c.close, c.volume || 0, source);
  });
  const text = `insert into market_data.candles_1m (pool, bucket, open, high, low, close, volume_usd, source) values ${rows.join(', ')}
    on conflict (pool, bucket) do update set open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
      volume_usd = excluded.volume_usd, source = excluded.source, updated_at = now()`;
  return { text, values };
}

async function db() {
  if (g.__mdPool) return g.__mdPool;
  const { default: pg } = await import('pg');
  const u = new URL(process.env.MARKET_DATA_DATABASE_URL!);
  u.searchParams.delete('sslmode');
  // Local/self-signed server cert: encrypted, not CA-verified. Set PG_SSL_CA to a CA file path to verify.
  const ca = process.env.PG_SSL_CA ? (await import('node:fs')).readFileSync(process.env.PG_SSL_CA, 'utf8') : undefined;
  g.__mdPool = new pg.Pool({ connectionString: u.toString(), max: 3, ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false } });
  g.__mdPool.on('error', (e) => { state.status.lastError = e.message; });
  return g.__mdPool;
}

export async function collectorTick(now = Date.now()) {
  const s = state.status; const o = collectorOpts();
  try {
    const [{ prisma }, { mem }, { minuteCandles }] = await Promise.all([import('./db'), import('./engine'), import('./gecko')]);
    const positions = await prisma.position.findMany({ where: { status: 'open' }, select: { pairAddress: true, mint: true, symbol: true } });
    const list = watchList(positions, mem.candidates, o.maxPools);
    s.pools = list.length;
    const pool = await db();
    for (const w of duePools(list, state.lastPolled, now, o.perTick, o.poolIntervalMs)) {
      const candles = await minuteCandles(w.pool, o.limit);
      if (candles === null) { s.rateLimited++; break; }           // bucket empty → leave budget to the charts
      state.lastPolled.set(w.pool, now);
      await pool.query(`insert into market_data.pools (address, dex, base_mint, base_symbol, quote_symbol, last_polled_at)
        values ($1, coalesce($2, 'unknown'), $3, $4, $5, now())
        on conflict (address) do update set last_polled_at = now(), base_symbol = coalesce(excluded.base_symbol, market_data.pools.base_symbol)`,
        [w.pool, w.dex ?? null, w.mint, w.symbol ?? null, w.quote ?? null]);
      if (candles.length) { const q = candleUpsertSql(w.pool, candles); await pool.query(q.text, q.values); s.candlesWritten += candles.length; }
    }
    s.ticks++; s.lastTickAt = new Date(now).toISOString(); s.lastError = null;
  } catch (e) { s.lastError = (e as Error).message.slice(0, 200); }
}

export function startCollector() {
  state.status.enabled = collectorEnabled();
  if (!state.status.enabled || state.timer) return;
  state.status.running = true;
  setTimeout(() => void collectorTick(), 15_000);
  state.timer = setInterval(() => void collectorTick(), collectorOpts().tickMs);
}

export const collectorStatus = (): CollectorStatus => ({ ...state.status, enabled: collectorEnabled() });

/** Stored 1m candles (seconds) for a pool, for native charts when GeckoTerminal is rate-limited. */
export async function storedCandles(poolAddr: string, sinceSec: number, limit = 1000): Promise<Candle[]> {
  if (!collectorEnabled()) return [];
  const r = await (await db()).query(
    `select extract(epoch from bucket)::bigint t, open, high, low, close, volume_usd from market_data.candles_1m where pool = $1 and bucket >= to_timestamp($2) order by bucket limit $3`,
    [poolAddr, sinceSec, limit]);
  return r.rows.map((x) => ({ time: Number(x.t), open: Number(x.open), high: Number(x.high), low: Number(x.low), close: Number(x.close), volume: Number(x.volume_usd) }));
}
