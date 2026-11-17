/**
 * Base-chain read-only market-data adapter.
 * External feeds are discovery hints, never trading signals.
 */
import type { AssetIdentity } from './multichain';

const API = 'https://api.dexscreener.com';
const CHAIN = 'base';
const MAX_BATCH = 30;
const MAX_DISCOVERY_TOKENS = 100;
const CACHE_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface BasePair {
  chainId: 'base'; dexId: string; pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd: number | null; volume24hUsd: number; liquidityUsd: number;
  fdvUsd: number | null; priceChange24hPct: number | null;
  pairCreatedAtMs: number | null; url: string | null;
}
type RawPair = {
  chainId?: unknown; dexId?: unknown; pairAddress?: unknown;
  baseToken?: { address?: unknown; name?: unknown; symbol?: unknown } | null;
  quoteToken?: { address?: unknown; symbol?: unknown } | null;
  priceUsd?: unknown; volume?: { h24?: unknown } | null;
  liquidity?: { usd?: unknown } | null; fdv?: unknown; marketCap?: unknown;
  priceChange?: { h24?: unknown } | null; pairCreatedAt?: unknown; url?: unknown;
};
type RawToken = { chainId?: unknown; tokenAddress?: unknown } | null;

function isAddress(value: unknown): value is string {
  return typeof value === 'string' && EVM_ADDRESS.test(value.trim());
}
function finite(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function nonNegative(value: unknown): number {
  const n = finite(value);
  return n !== null && n >= 0 ? n : 0;
}
function positiveOrNull(value: unknown): number | null {
  const n = finite(value);
  return n !== null && n > 0 ? n : null;
}
function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : null; }
  catch { return null; }
}

/** Parse only valid Base EVM token identities; deduplicate case-insensitively. */
export function parseBaseTokenIdentities(input: unknown): AssetIdentity[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: AssetIdentity[] = [];
  for (const item of input as RawToken[]) {
    if (item?.chainId !== CHAIN || !isAddress(item.tokenAddress)) continue;
    const address = item.tokenAddress.trim();
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ network: 'base', address });
  }
  return out;
}

/** Parse complete Base pairs and fail closed on malformed addresses/numbers. */
export function parseBasePairs(input: unknown): BasePair[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: BasePair[] = [];
  for (const item of input as RawPair[]) {
    if (item?.chainId !== CHAIN || !isAddress(item.pairAddress) ||
        !isAddress(item.baseToken?.address) || !isAddress(item.quoteToken?.address)) continue;
    const pairAddress = item.pairAddress.trim();
    const key = pairAddress.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const createdAt = positiveOrNull(item.pairCreatedAt);
    const priceChange = finite(item.priceChange?.h24);
    out.push({
      chainId: CHAIN,
      dexId: typeof item.dexId === 'string' && item.dexId.trim() ? item.dexId.trim() : 'unknown',
      pairAddress,
      baseToken: {
        address: item.baseToken!.address!.toString().trim(),
        name: typeof item.baseToken?.name === 'string' ? item.baseToken.name : '',
        symbol: typeof item.baseToken?.symbol === 'string' ? item.baseToken.symbol : '',
      },
      quoteToken: {
        address: item.quoteToken!.address!.toString().trim(),
        symbol: typeof item.quoteToken?.symbol === 'string' ? item.quoteToken.symbol : '',
      },
      priceUsd: positiveOrNull(item.priceUsd),
      volume24hUsd: nonNegative(item.volume?.h24),
      liquidityUsd: nonNegative(item.liquidity?.usd),
      fdvUsd: positiveOrNull(item.fdv) ?? positiveOrNull(item.marketCap),
      priceChange24hPct: priceChange,
      pairCreatedAtMs: createdAt === null ? null : Math.trunc(createdAt),
      url: safeHttpsUrl(item.url),
    });
  }
  return out;
}

/** DexScreener priceUsd is the BASE token price; never relabel quote-side matches. */
export function filterBasePairsForTokens(pairs: BasePair[], addresses: string[]): BasePair[] {
  const requested = new Set(addresses.filter(isAddress).map((address) => address.trim().toLowerCase()));
  return pairs.filter((pair) => requested.has(pair.baseToken.address.toLowerCase()));
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
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

/** Use any healthy discovery feed; fail only when every feed fails. */
export async function discoverBaseTokens(): Promise<AssetIdentity[]> {
  const feeds = ['/token-profiles/latest/v1', '/token-boosts/latest/v1', '/token-boosts/top/v1'];
  const responses = await Promise.allSettled(feeds.map((path) => cached(path, () => getJson<unknown>(API + path))));
  const found = new Map<string, AssetIdentity>();
  let healthyFeeds = 0;
  for (const response of responses) {
    if (response.status !== 'fulfilled') continue;
    healthyFeeds++;
    for (const asset of parseBaseTokenIdentities(response.value)) found.set(asset.address.toLowerCase(), asset);
  }
  if (!healthyFeeds) throw new Error('All DexScreener Base discovery feeds failed');
  return [...found.values()].slice(0, MAX_DISCOVERY_TOKENS);
}

/** Provider-bounded batches; a failed batch fails the snapshot, not silently partial data. */
export async function fetchBasePairsForTokens(addresses: string[]): Promise<BasePair[]> {
  const unique = [...new Set(addresses.filter(isAddress).map((address) => address.trim()))];
  const all: BasePair[] = [];
  for (let i = 0; i < unique.length; i += MAX_BATCH) {
    const batch = unique.slice(i, i + MAX_BATCH);
    const path = `/tokens/v1/${CHAIN}/${batch.map(encodeURIComponent).join(',')}`;
    const pairs = parseBasePairs(await cached(path, () => getJson<unknown>(API + path)));
    all.push(...filterBasePairsForTokens(pairs, batch));
  }
  return all;
}

/** Rank by liquidity depth, then 24h volume; avoid arbitrary blended weights. */
export function bestBasePairPerToken(pairs: BasePair[]): Map<string, BasePair> {
  const out = new Map<string, BasePair>();
  for (const pair of pairs) {
    if (!pair.priceUsd || pair.liquidityUsd <= 0) continue;
    const key = pair.baseToken.address.toLowerCase();
    const previous = out.get(key);
    if (!previous || pair.liquidityUsd > previous.liquidityUsd ||
        (pair.liquidityUsd === previous.liquidityUsd && pair.volume24hUsd > previous.volume24hUsd)) {
      out.set(key, pair);
    }
  }
  return out;
}

/** Bounded end-to-end read-only snapshot. */
export async function fetchBaseMarketSnapshot(limit = 30): Promise<BasePair[]> {
  if (!Number.isFinite(limit)) throw new Error('Base market snapshot limit must be finite');
  const max = Math.max(1, Math.min(MAX_DISCOVERY_TOKENS, Math.floor(limit)));
  const assets = (await discoverBaseTokens()).slice(0, max);
  const pairs = await fetchBasePairsForTokens(assets.map((asset) => asset.address));
  return [...bestBasePairPerToken(pairs).values()];
}
