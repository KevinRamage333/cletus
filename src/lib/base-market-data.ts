/**
 * Base-chain read-only market data adapter.
 * Uses DexScreener public discovery + pair endpoints. No quotes, signing, writes, or trading.
 */
import type { AssetIdentity } from './multichain';

const API = 'https://api.dexscreener.com';
const CHAIN = 'base';
const MAX_BATCH = 30;
const CACHE_TTL_MS = 30_000;

export interface BasePair {
  chainId: 'base'; dexId: string; pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd: number | null; volume24hUsd: number; liquidityUsd: number;
  fdvUsd: number | null; priceChange24hPct: number | null;
  pairCreatedAtMs: number | null; url: string | null;
}
type RawPair = {
  chainId?: string; dexId?: string; pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string; volume?: { h24?: number }; liquidity?: { usd?: number };
  fdv?: number; marketCap?: number; priceChange?: { h24?: number };
  pairCreatedAt?: number; url?: string;
};
function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Parse only Base pairs; reject incomplete records and de-duplicate pair addresses. */
export function parseBasePairs(input: unknown): BasePair[] {
  if (! Array.isArray(input)) return [];
  const out: BasePair[] = [];
  const seen = new Set<string>();
  for (const item of input as RawPair[]) {
    if (item?.chainId !== CHAIN || !item.pairAddress || !item.baseToken?.address || !item.quoteToken?.address) continue;
    const key = item.pairAddress.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      chainId: CHAIN, dexId: item.dexId ?? 'unknown', pairAddress: item.pairAddress,
      baseToken: { address: item.baseToken.address, name: item.baseToken.name ?? '', symbol: item.baseToken.symbol ?? '' },
      quoteToken: { address: item.quoteToken.address, symbol: item.quoteToken.symbol ?? '' },
      priceUsd: finite(item.priceUsd), volume24hUsd: Math.max(0, finite(item.volume?.h24) ?? 0),
      liquidityUsd: Math.max(0, finite(item.liquidity?.usd) ?? 0),
      fdvUsd: finite(item.fdv ?? item.marketCap), priceChange24hPct: finite(item.priceChange?.h24),
      pairCreatedAtMs: finite(item.pairCreatedAt), url: typeof item.url === 'string' ? item.url : null,
    });
  }
  return out;
}

/** Parse DexScreener profile/boost feeds into Base token identities only. */
export function parseBaseTokenIdentities(input: unknown): AssetIdentity[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: AssetIdentity[] = [];
  for (const item of input as Array<{ chainId?: string; tokenAddress?: string }>) {
    const address = item?.tokenAddress?.trim();
    if (item?.chainId !== CHAIN || !address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ network: 'base', address });
  }
  return out;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000), cache: 'no-store',
  });
  if (!response.ok) throw new Error(`DexScreener Base API HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Discovery candidates only; profile/boost presence is not a buy signal. */
export async function discoverBaseTokens(): Promise<AssetIdentity[]> {
  const feeds = ['/token-profiles/latest/v1', '/token-boosts/latest/v1', '/token-boosts/top/v1'];
  const responses = await Promise.allSettled(feeds.map((path) => cached(path, () => getJson<unknown>(API + path))));
  const found = new Map<string, AssetIdentity>();
  let successfulFeeds = 0;
  for (const result of responses) {
    if (result.status !== 'fulfilled') continue;
    successfulFeeds++;
    for (const asset of parseBaseTokenIdentities(result.value)) found.set(asset.address.toLowerCase(), asset);
  }
  if (!successfulFeeds) throw new Error('All DexScreener Base discovery feeds failed');
  return [...found.values()];
}

/** DexScreener token-pairs endpoint, in batches of at most 30 token addresses. */
export async function fetchBasePairsForTokens(addresses: string[]): Promise<BasePair[]> {
  const unique = [...new Set(addresses.map((a) => a.trim()).filter(Boolean))];
  const all: BasePair[] = [];
  for (let i = 0; i < unique.length; i += MAX_BATCH) {
    const batch = unique.slice(i, i + MAX_BATCH);
    const path = `/tokens/v1/${CHAIN}/${batch.map(encodeURIComponent).join(',')}`;
    all.push(...parseBasePairs(await cached(path, () => getJson<unknown>(API + path))));
  }
  return all;
}

/** Pick the deepest/most active pair for each base token. */
export function bestBasePairPerToken(pairs: BasePair[]): Map<string, BasePair> {
  const out = new Map<string, BasePair>();
  const score = (p: BasePair) => p.liquidityUsd * 10 + p.volume24hUsd;
  for (const pair of pairs) {
    const key = pair.baseToken.address.toLowerCase();
    const previous = out.get(key);
    if (!previous || score(pair) > score(previous)) out.set(key, pair);
  }
  return out;
}

/** Bounded end-to-end read-only snapshot of newly discovered Base tokens. */
export async function fetchBaseMarketSnapshot(limit = 30): Promise<BasePair[]> {
  const max = Math.max(1, Math.min(100, Math.floor(limit)));
  const assets = (await discoverBaseTokens()).slice(0, max);
  const pairs = await fetchBasePairsForTokens(assets.map((asset) => asset.address));
  return [...bestBasePairPerToken(pairs).values()];
}
