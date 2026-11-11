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
  // When the pump-age filter is on, also search pump.fun so graduations show up even if they missed the profile feeds.
  if (['on', 'true', '1', 'yes'].includes((process.env.PUMP_AGE_FILTER ?? '').trim().toLowerCase()) && !queries.includes('pump.fun')) queries.push('pump.fun');
  const searches = await Promise.allSettled(queries.map((q) => getJson<{ pairs?: DexPair[] }>(`${BASE}/latest/dex/search?q=${encodeURIComponent(q)}`)));
  for (const r of searches) {
    if (r.status !== 'fulfilled') continue;
    ok++;
    for (const p of r.value.pairs ?? []) if (p.chainId === 'solana' && p.baseToken?.address) mints.add(p.baseToken.address);
  }
  if (ok === 0) throw new Error('All DexScreener discovery feeds failed');
  // Fresh GeckoTerminal new_pools (listings + pump.fun graduations) when PUMP_AGE_FILTER is on.
  try {
    const { pumpAgeFromEnv, mergeMints } = await import('./pump-age');
    const pa = pumpAgeFromEnv(process.env);
    if (pa?.discoverFreshPools) {
      const { fetchNewSolanaPools } = await import('./gecko');
      const fresh = await fetchNewSolanaPools(2);
      if (fresh.length) return mergeMints([...mints], fresh.map((x) => x.mint));
    }
  } catch { /* discovery must still return the DexScreener set */ }
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

let solCache: { at: number; v: number } | null = null;
export async function fetchSolPriceUsd(fallback: number): Promise<number> {
  if (solCache && Date.now() - solCache.at < 30_000) return solCache.v;
  try {
    const { jupPrices, SOL_MINT } = await import('./jupiter');
    const p = (await jupPrices([SOL_MINT], { maxWaitMs: 4000 }))[SOL_MINT];
    if (p && p > 0) { solCache = { at: Date.now(), v: p }; return p; }
  } catch { /* fall through */ }
  return solCache?.v ?? fallback;
}
