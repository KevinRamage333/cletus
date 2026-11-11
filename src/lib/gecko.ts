/**
 * GeckoTerminal public API (≈30 req/min). Token-bucket limiter (default 25/min, GECKO_RPM) + response cache, so many
 * viewers polling the same pool cost one upstream call per TTL.
 */
const GT = 'https://api.geckoterminal.com/api/v2';
export type Timeframe = 'minute' | 'hour' | 'day';
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

interface Bucket { tokens: number; at: number }
const g = globalThis as unknown as { __gtBucket?: Bucket; __gtCache?: Map<string, { at: number; v: unknown }>; __gtInflight?: Map<string, Promise<unknown>> };
const bucket = (g.__gtBucket ??= { tokens: Number(process.env.GECKO_RPM ?? 25), at: Date.now() });
const cache = (g.__gtCache ??= new Map());
const inflight = (g.__gtInflight ??= new Map());

/** Token bucket: refills at rpm/60 per second. Exported for tests. */
export function takeToken(b: Bucket, rpm: number, now = Date.now()): boolean {
  b.tokens = Math.min(rpm, b.tokens + ((now - b.at) / 60_000) * rpm);
  b.at = now;
  if (b.tokens >= 1) { b.tokens -= 1; return true; }
  return false;
}

async function cached<T>(key: string, ttlMs: number, f: () => Promise<T>): Promise<{ v: T | null; stale: boolean; limited: boolean }> {
  const hit = cache.get(key) as { at: number; v: T } | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return { v: hit.v, stale: false, limited: false };
  if (inflight.has(key)) return { v: (await inflight.get(key)) as T, stale: false, limited: false };
  if (!takeToken(bucket, Number(process.env.GECKO_RPM ?? 25))) return { v: hit?.v ?? null, stale: !!hit, limited: true };
  const p = f().then((v) => { cache.set(key, { at: Date.now(), v }); return v; }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  try { return { v: await p, stale: false, limited: false }; } catch { return { v: hit?.v ?? null, stale: !!hit, limited: false }; }
}

/** GeckoTerminal ohlcv_list rows ([ts, o, h, l, c, v], newest first) → ascending candles. Exported for tests. */
export function parseOhlcv(json: unknown): Candle[] {
  const rows = ((json as { data?: { attributes?: { ohlcv_list?: number[][] } } })?.data?.attributes?.ohlcv_list ?? []) as number[][];
  const seen = new Set<number>();
  return rows
    .map((r) => ({ time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5] ?? 0) }))
    .filter((c) => Number.isFinite(c.time) && c.close > 0 && !seen.has(c.time) && seen.add(c.time))
    .sort((a, b) => a.time - b.time);
}

export const RANGES: Record<string, { tf: Timeframe; aggregate: number; limit: number; ttlMs: number }> = {
  '1H': { tf: 'minute', aggregate: 1, limit: 60, ttlMs: 15_000 },
  '4H': { tf: 'minute', aggregate: 5, limit: 48, ttlMs: 20_000 },
  '1D': { tf: 'minute', aggregate: 15, limit: 96, ttlMs: 30_000 },
  '1W': { tf: 'hour', aggregate: 1, limit: 168, ttlMs: 120_000 },
  '1M': { tf: 'hour', aggregate: 4, limit: 180, ttlMs: 300_000 },
  '1Y': { tf: 'day', aggregate: 1, limit: 365, ttlMs: 900_000 },
};

export async function poolOhlcv(pool: string, range: string) {
  const r = RANGES[range] ?? RANGES['1D'];
  return cached(`ohlcv:${pool}:${range}`, r.ttlMs, async () => {
    const res = await fetch(`${GT}/networks/solana/pools/${pool}/ohlcv/${r.tf}?aggregate=${r.aggregate}&limit=${r.limit}&currency=usd`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
    return parseOhlcv(await res.json());
  });
}

/** 1-minute candles for the market_data collector. Shares the same token bucket + cache as the charts,
 *  so the collector can never push GeckoTerminal past GECKO_RPM. Returns null when rate-limited. */
export async function minuteCandles(pool: string, limit = 100): Promise<Candle[] | null> {
  const r = await cached(`collect:${pool}`, 20_000, async () => {
    const res = await fetch(`${GT}/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=${limit}&currency=usd`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
    return parseOhlcv(await res.json());
  });
  return r.limited ? null : r.v;
}

/** 5-minute candles for pump-age (up to ~25h at limit=300). Null when rate-limited. */
export async function fiveMinuteCandles(pool: string, limit = 300): Promise<Candle[] | null> {
  const r = await cached(`ohlcv5m:${pool}:${limit}`, 60_000, async () => {
    const res = await fetch(`${GT}/networks/solana/pools/${pool}/ohlcv/minute?aggregate=5&limit=${limit}&currency=usd`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
    return parseOhlcv(await res.json());
  });
  return r.limited ? null : r.v;
}

export interface FreshPool { mint: string; pool: string; createdAt: string | null; symbol?: string }

/** Parse GeckoTerminal /networks/{network}/new_pools JSON (data + included tokens). */
export function parseNewPools(json: unknown): FreshPool[] {
  const root = json as { data?: Array<{ type?: string; id?: string; attributes?: { address?: string; pool_created_at?: string }; relationships?: { base_token?: { data?: { id?: string } } } }>; included?: Array<{ id?: string; type?: string; attributes?: { address?: string; symbol?: string } }> };
  const included = new Map<string, { address?: string; symbol?: string }>();
  for (const inc of root.included ?? []) {
    if (inc?.id) included.set(inc.id, inc.attributes ?? {});
  }
  const out: FreshPool[] = [];
  const seen = new Set<string>();
  for (const d of root.data ?? []) {
    if (d?.type && d.type !== 'pool') continue;
    const pool = d.attributes?.address ?? String(d.id ?? '').replace(/^solana[_/]/, '');
    const baseId = d.relationships?.base_token?.data?.id;
    const inc = baseId ? included.get(baseId) : undefined;
    const mint = inc?.address ?? (baseId ? String(baseId).replace(/^solana[_/]/, '') : '');
    if (!mint || !pool || seen.has(mint)) continue;
    seen.add(mint);
    out.push({ mint, pool, createdAt: d.attributes?.pool_created_at ?? null, symbol: inc?.symbol });
  }
  return out;
}

/** Recent Solana pools from GeckoTerminal (new listings / pump.fun graduations appear here). */
export async function fetchNewSolanaPools(pages = 1): Promise<FreshPool[]> {
  const n = Math.max(1, Math.min(3, pages));
  const out: FreshPool[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= n; page++) {
    const r = await cached(`new_pools:${page}`, 60_000, async () => {
      const res = await fetch(`${GT}/networks/solana/new_pools?page=${page}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000), cache: 'no-store' });
      if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
      return parseNewPools(await res.json());
    });
    for (const p of r.v ?? []) {
      if (seen.has(p.mint)) continue;
      seen.add(p.mint);
      out.push(p);
    }
  }
  return out;
}
