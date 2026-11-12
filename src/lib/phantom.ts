/**
 * Phantom trending tokens: the public, no-auth list behind Phantom's Explore / phantom.com/tokens
 * (`api.phantom.app/explore/v2/trending-tokens`). Phantom offers 1h / 4h / 12h / 24h windows
 * (no 5m/6h). Used as an extra scan source; mints are deduped with the DexScreener/Gecko sets.
 */

export const PHANTOM_TIMEFRAMES = ['1h', '4h', '12h', '24h'] as const;
export type PhantomTimeframe = (typeof PHANTOM_TIMEFRAMES)[number];

export interface PhantomTrendingItem {
  chainId?: string;
  address?: string;
  symbol?: string;
  marketCap?: number | null;
  spamStatus?: string;
}

const URL_BASE = 'https://api.phantom.app/explore/v2/trending-tokens';
/** Native SOL / wrapped SOL / USDC / USDT: never scan candidates. */
const SKIP = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);

export function phantomTrendingUrl(tf: PhantomTimeframe, limit = 50): string {
  const n = Math.max(1, Math.min(50, limit));
  return `${URL_BASE}?timeFrame=${tf}&sortBy=rank&sortDirection=asc&limit=${n}&rankAlgo=default&chainIds=${encodeURIComponent('solana:101')}`;
}

/**
 * Solana mints from Phantom trending items. Drops non-Solana, stables/SOL, Phantom-flagged spam,
 * and (when a band is given) anything whose reported market cap is far outside it; the scan's own
 * market-cap filter still decides on the live DexScreener pair.
 */
export function phantomMintsFromItems(items: PhantomTrendingItem[], band?: { min: number; max: number }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items ?? []) {
    const mint = it?.address;
    if (!mint || it.chainId !== 'solana:101' || SKIP.has(mint) || seen.has(mint)) continue;
    if ((it.spamStatus ?? '').toUpperCase() === 'SPAM') continue;
    const mc = typeof it.marketCap === 'number' && Number.isFinite(it.marketCap) ? it.marketCap : null;
    if (band && mc != null && mc > 0 && (mc < band.min * 0.5 || mc > band.max * 2)) continue;
    seen.add(mint);
    out.push(mint);
  }
  return out;
}

export interface PhantomTrendingResult { mints: string[]; raw: number; okFrames: number }

let cache: { at: number; key: string; v: PhantomTrendingResult } | null = null;

/** Fetch Phantom trending across timeframes (cached 60s). Never throws; returns [] on failure. */
export async function fetchPhantomTrendingMints(opts: { timeframes?: readonly PhantomTimeframe[]; band?: { min: number; max: number }; limit?: number } = {}): Promise<PhantomTrendingResult> {
  const tfs = opts.timeframes?.length ? opts.timeframes : PHANTOM_TIMEFRAMES;
  const key = `${tfs.join(',')}|${opts.band?.min ?? ''}-${opts.band?.max ?? ''}|${opts.limit ?? 50}`;
  if (cache && cache.key === key && Date.now() - cache.at < 60_000) return cache.v;
  const results = await Promise.allSettled(tfs.map(async (tf) => {
    const res = await fetch(phantomTrendingUrl(tf, opts.limit ?? 50), { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (cletus scanner)' }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!res.ok) throw new Error(`Phantom trending HTTP ${res.status}`);
    const j = (await res.json()) as { items?: PhantomTrendingItem[] };
    return Array.isArray(j?.items) ? j.items : [];
  }));
  const items: PhantomTrendingItem[] = [];
  let okFrames = 0;
  for (const r of results) if (r.status === 'fulfilled') { okFrames++; items.push(...r.value); }
  const v = { mints: phantomMintsFromItems(items, opts.band), raw: items.length, okFrames };
  if (okFrames > 0) cache = { at: Date.now(), key, v };
  return v;
}

export function parsePhantomTimeframes(raw: string | undefined): PhantomTimeframe[] {
  if (!raw?.trim()) return [...PHANTOM_TIMEFRAMES];
  const want = raw.split(',').map((s) => s.trim().toLowerCase());
  const tfs = PHANTOM_TIMEFRAMES.filter((t) => want.includes(t));
  return tfs.length ? tfs : [...PHANTOM_TIMEFRAMES];
}
