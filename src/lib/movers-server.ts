import { bestPairs, toMoverCard, type MoverCard, type PairWithInfo, type ProfileEntry } from './movers';

const BASE = 'https://api.dexscreener.com';
const TTL_MS = 15_000;
type Board = { at: number; cards: MoverCard[]; sources: string[]; errors: string[] };
let cache: Board | null = null;
let inflight: Promise<Board> | null = null;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8_000), headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchSolanaPairs(mints: string[]): Promise<PairWithInfo[]> {
  const out: PairWithInfo[] = [];
  const batches: string[][] = [];
  for (let i = 0; i < mints.length; i += 30) batches.push(mints.slice(i, i + 30));
  const results = await Promise.allSettled(batches.map((b) => getJson<PairWithInfo[]>(`/tokens/v1/solana/${b.join(',')}`)));
  for (const r of results) if (r.status === 'fulfilled' && Array.isArray(r.value)) out.push(...r.value);
  if (batches.length && results.every((r) => r.status === 'rejected')) throw new Error('DexScreener pairs unavailable');
  return out;
}

async function build(): Promise<Board> {
  const errors: string[] = [];
  const feeds = await Promise.allSettled([
    getJson<ProfileEntry[]>('/token-profiles/latest/v1'),
    getJson<ProfileEntry[]>('/token-boosts/latest/v1'),
    getJson<ProfileEntry[]>('/token-boosts/top/v1'),
  ]);
  const names = ['token-profiles/latest', 'token-boosts/latest', 'token-boosts/top'];
  const icons = new Map<string, string>();
  const boosted = new Set<string>();
  const mints: string[] = [];
  feeds.forEach((f, i) => {
    if (f.status === 'rejected') { errors.push(`${names[i]} unavailable`); return; }
    for (const e of f.value ?? []) {
      if (e.chainId !== 'solana' || !e.tokenAddress) continue;
      if (!mints.includes(e.tokenAddress)) mints.push(e.tokenAddress);
      if (e.icon && !icons.has(e.tokenAddress)) icons.set(e.tokenAddress, e.icon);
      if (i > 0) boosted.add(e.tokenAddress);
    }
  });
  if (!mints.length) throw new Error('No Solana tokens from DexScreener feeds');
  const best = bestPairs(await fetchSolanaPairs(mints.slice(0, 90)));
  const cards = mints.map((m) => best.get(m)).filter((p): p is PairWithInfo => !!p).map((p) => toMoverCard(p, icons.get(p.baseToken.address), boosted.has(p.baseToken.address)));
  return { at: Date.now(), cards, sources: ['DexScreener public API'], errors };
}

/** Cached for 15s and de-duplicated across concurrent requests. On failure, the last good board is returned marked stale. */
export async function getMovers(): Promise<{ fetchedAt: string | null; tokens: MoverCard[]; sources: string[]; errors: string[]; stale: boolean }> {
  if (cache && Date.now() - cache.at < TTL_MS) return { fetchedAt: new Date(cache.at).toISOString(), tokens: cache.cards, sources: cache.sources, errors: cache.errors, stale: false };
  try {
    inflight ??= build().finally(() => { inflight = null; });
    cache = await inflight;
    return { fetchedAt: new Date(cache.at).toISOString(), tokens: cache.cards, sources: cache.sources, errors: cache.errors, stale: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unavailable';
    if (cache) return { fetchedAt: new Date(cache.at).toISOString(), tokens: cache.cards, sources: cache.sources, errors: [...cache.errors, msg], stale: true };
    throw e;
  }
}
