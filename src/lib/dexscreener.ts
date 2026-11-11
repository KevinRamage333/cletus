/** DexScreener client: builds the Solana micro-cap universe from public endpoints. */

export interface DexPair {
  chainId: string;
  dexId: string;
  url?: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  priceNative?: string;
  txns?: Record<'m5' | 'h1' | 'h6' | 'h24', { buys: number; sells: number }>;
  volume?: Partial<Record<'m5' | 'h1' | 'h6' | 'h24', number>>;
  priceChange?: Partial<Record<'m5' | 'h1' | 'h6' | 'h24', number>>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

const BASE = 'https://api.dexscreener.com';

async function getJson<T>(url: string, timeoutMs = 10000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`DexScreener ${res.status} for ${url.replace(BASE, '')}`);
  return (await res.json()) as T;
}

/** Candidate Solana token addresses from the profile/boost/takeover feeds. */
export async function discoverSolanaMints(): Promise<string[]> {
  const feeds = ['/token-profiles/latest/v1', '/token-boosts/latest/v1', '/token-boosts/top/v1', '/community-takeovers/latest/v1'];
  const results = await Promise.allSettled(feeds.map((f) => getJson<Array<{ chainId: string; tokenAddress: string }>>(BASE + f)));
  const mints = new Set<string>();
  let ok = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
    ok++;
    for (const t of r.value) if (t.chainId === 'solana' && t.tokenAddress) mints.add(t.tokenAddress);
  }
  // Broaden the universe with DexScreener pair search (30 pairs per query), Solana only.
  const queries = (process.env.SCAN_SEARCH_QUERIES ?? 'pump,pumpswap,raydium,meteora,solana').split(',').map((q) => q.trim()).filter(Boolean);
  const searches = await Promise.allSettled(queries.map((q) => getJson<{ pairs?: DexPair[] }>(`${BASE}/latest/dex/search?q=${encodeURIComponent(q)}`)));
  for (const r of searches) {
    if (r.status !== 'fulfilled') continue;
    ok++;
    for (const p of r.value.pairs ?? []) if (p.chainId === 'solana' && p.baseToken?.address) mints.add(p.baseToken.address);
  }
  if (ok === 0) throw new Error('All DexScreener discovery feeds failed');
  return [...mints];
}

/** Fetch pairs for up to N mints (batched 30 per request). Returns the most liquid/active pair per mint. */
export async function fetchPairsForMints(mints: string[]): Promise<Map<string, DexPair>> {
  const out = new Map<string, DexPair>();
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    const pairs = await getJson<DexPair[]>(`${BASE}/tokens/v1/solana/${batch.join(',')}`);
    for (const p of pairs ?? []) {
      if (p.chainId !== 'solana') continue;
      const mint = p.baseToken.address;
      if (!batch.includes(mint)) continue; // skip pairs where our token is the quote
      const prev = out.get(mint);
      const score = (x: DexPair) => (x.liquidity?.usd ?? 0) * 10 + (x.volume?.h24 ?? 0);
      if (!prev || score(p) > score(prev)) out.set(mint, p);
    }
  }
  return out;
}

export async function fetchSolPriceUsd(fallback: number): Promise<number> {
  try {
    const r = await getJson<Record<string, { usdPrice: number }>>('https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112', 6000);
    const p = r['So11111111111111111111111111111111111111112']?.usdPrice;
    return p && p > 0 ? p : fallback;
  } catch {
    return fallback;
  }
}
