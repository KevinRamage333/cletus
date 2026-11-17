/** DexScreener lookups for the chart/search pages, cached 30s in a bounded LRU (500 entries). */
const cache = new Map<string, { at: number; v: unknown }>();
export const DEX_CACHE_MAX = 500;
function remember(url: string, v: unknown) {
  cache.delete(url);
  cache.set(url, { at: Date.now(), v });
  while (cache.size > DEX_CACHE_MAX) cache.delete(cache.keys().next().value as string);
}
export const _dexCacheSize = () => cache.size;
async function get<T>(url: string, ttl = 30_000): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.v as T;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!r.ok) return (hit?.v as T) ?? null;
    const v = (await r.json()) as T; remember(url, v); return v;
  } catch { return (hit?.v as T) ?? null; }
}
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface PairInfo { pairAddress: string; dexId: string; mint: string; symbol: string; name: string; quote: string; priceUsd: number | null; change24h: number | null; volume24h: number | null; mcap: number | null; liquidityUsd: number | null; url: string | null; image: string | null }
const toInfo = (p: any): PairInfo => ({
  pairAddress: p.pairAddress, dexId: p.dexId, mint: p.baseToken?.address, symbol: p.baseToken?.symbol, name: p.baseToken?.name, quote: p.quoteToken?.symbol,
  priceUsd: Number(p.priceUsd) || null, change24h: p.priceChange?.h24 ?? null, volume24h: p.volume?.h24 ?? null, mcap: p.marketCap ?? p.fdv ?? null,
  liquidityUsd: p.liquidity?.usd ?? null, url: p.url ?? null, image: p.info?.imageUrl ?? null,
});
/** Most liquid Solana pool for a mint (or the pair itself if a pair address was given). */
export async function bestPool(address: string): Promise<PairInfo | null> {
  const pairs = (await get<any[]>(`https://api.dexscreener.com/tokens/v1/solana/${address}`)) ?? [];
  if (pairs.length) return toInfo([...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]);
  const pr = await get<{ pairs?: any[]; pair?: any }>(`https://api.dexscreener.com/latest/dex/pairs/solana/${address}`);
  const p = pr?.pairs?.[0] ?? pr?.pair;
  return p ? toInfo(p) : null;
}
export async function searchTokens(q: string): Promise<PairInfo[]> {
  const r = await get<{ pairs?: any[] }>(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
  const best = new Map<string, any>();
  for (const p of r?.pairs ?? []) {
    if (p.chainId !== 'solana') continue;
    const k = p.baseToken?.address; const cur = best.get(k);
    if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(k, p);
  }
  return [...best.values()].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)).slice(0, 15).map(toInfo);
}
