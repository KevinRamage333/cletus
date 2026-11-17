/**
 * Base-chain market-data adapter.
 *
 * This module is intentionally read-only. Discovery feeds are candidate sources,
 * never trading signals. DexScreener priceUsd belongs to the pair's base token;
 * quote-side matches are excluded until quote-token USD normalization is implemented.
 */
import type { AssetIdentity } from './multichain';

const API = 'https://api.dexscreener.com';
const CHAIN = 'base';
const MAX_BATCH = 30;
const MAX_DISCOVERY_TOKENS = 100;
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 256;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface BasePair {
  chainId: 'base';
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd: number | null;
  volume24hUsd: number;
  liquidityUsd: number;
  fdvUsd: number | null;
  priceChange24hPct: number | null;
  pairCreatedAtMs: number | null;
  url: string | null;
}

type RawPair = {
  chainId?: unknown;
  dexId?: unknown;
  pairAddress?: unknown;
  baseToken?: { address?: unknown; name?: unknown; symbol?: unknown } | null;
  quoteToken?: { address?: unknown; symbol?: unknown } | null;
  priceUsd?: unknown;
  volume?: { h24?: unknown } | null;
  liquidity?: { usd?: unknown } | null;
  fdv?: unknown;
  marketCap?: unknown;
  priceChange?: { h24?: unknown } | null;
  pairCreatedAt?: unknown;
  url?: unknown;
};
type RawToken = { chainId?: unknown; tokenAddress?: unknown } | null;

export function isBaseAddress(value: unknown): value is string {
  return typeof value === 'string' && EVM_ADDRESS.test(value.trim());
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegative(value: unknown): number {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : 0;
}

function positiveOrNull(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function safePairUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || (url.hostname !== 'dexscreener.com' && !url.hostname.endsWith('.dexscreener.com'))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Accept only Base EVM token identities and deduplicate case-insensitively. */
export function parseBaseTokenIdentities(input: unknown): AssetIdentity[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const output: AssetIdentity[] = [];
  for (const item of input as RawToken[]) {
    if (item?.chainId !== CHAIN || !isBaseAddress(item.tokenAddress)) continue;
    const address = item.tokenAddress.trim();
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ network: CHAIN, address });
  }
  return output;
}

/** Normalize provider pairs; malformed chain/address data is rejected, missing price stays null. */
export function parseBasePairs(input: unknown): BasePair[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const output: BasePair[] = [];
  for (const item of input as RawPair[]) {
    if (item?.chainId !== CHAIN ||
        !isBaseAddress(item.pairAddress) ||
        !isBaseAddress(item.baseToken?.address) ||
        !isBaseAddress(item.quoteToken?.address)) continue;

    const pairAddress = item.pairAddress.trim();
    const key = pairAddress.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const createdAt = positiveOrNull(item.pairCreatedAt);
    output.push({
      chainId: CHAIN,
      dexId: typeof item.dexId === 'string' && item.dexId.trim() ? item.dexId.trim() : 'unknown',
      pairAddress,
      baseToken: {
        address: item.baseToken!.address as string,
        name: typeof item.baseToken?.name === 'string' ? item.baseToken.name : '',
        symbol: typeof item.baseToken?.symbol === 'string' ? item.baseToken.symbol : '',
      },
      quoteToken: {
        address: item.quoteToken!.address as string,
        symbol: typeof item.quoteToken?.symbol === 'string' ? item.quoteToken.symbol : '',
      },
      priceUsd: positiveOrNull(item.priceUsd),
      volume24hUsd: nonNegative(item.volume?.h24),
      liquidityUsd: nonNegative(item.liquidity?.usd),
      fdvUsd: positiveOrNull(item.fdv) ?? positiveOrNull(item.marketCap),
      priceChange24hPct: finite(item.priceChange?.h24),
      pairCreatedAtMs: createdAt === null ? null : Math.trunc(createdAt),
      url: safePairUrl(item.url),
    });
  }
  return output;
}

/** DexScreener priceUsd is the BASE token price; do not mislabel quote-side matches. */
export function filterBasePairsForTokens(pairs: BasePair[], addresses: string[]): BasePair[] {
  const requested = new Set(addresses.filter(isBaseAddress).map(address => address.trim().toLowerCase()));
  return pairs.filter(pair => requested.has(pair.baseToken.address.toLowerCase()));
}

const responseCache = new Map<string, { cachedAt: number; value: unknown }>();

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`DexScreener Base API HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

/** Cache only successful responses and bound memory use in long-lived workers. */
async function cachedJson<T>(path: string): Promise<T> {
  const hit = responseCache.get(path);
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) return hit.value as T;
  if (hit) responseCache.delete(path);

  const value = await getJson<T>(`${API}${path}`);
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest) responseCache.delete(oldest);
  }
  responseCache.set(path, { cachedAt: Date.now(), value });
  return value;
}

/** Discovery feeds are best-effort; fail only when every feed is unavailable. */
export async function discoverBaseTokens(): Promise<AssetIdentity[]> {
  const feeds = ['/token-profiles/latest/v1', '/token-boosts/latest/v1', '/token-boosts/top/v1'];
  const results = await Promise.allSettled(feeds.map(path => cachedJson<unknown>(path)));
  const tokens = new Map<string, AssetIdentity>();
  let healthyFeeds = 0;

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    healthyFeeds += 1;
    for (const token of parseBaseTokenIdentities(result.value)) {
      tokens.set(token.address.toLowerCase(), token);
    }
  }
  if (healthyFeeds === 0) throw new Error('All DexScreener Base discovery feeds failed');
  return [...tokens.values()].slice(0, MAX_DISCOVERY_TOKENS);
}

/** Fetch Base pairs in provider-sized batches; never request malformed addresses. */
export async function fetchBasePairsForTokens(addresses: string[]): Promise<BasePair[]> {
  const unique = [...new Map(
    addresses.filter(isBaseAddress).map(address => [address.trim().toLowerCase(), address.trim()]),
  ).values()];
  const output: BasePair[] = [];

  for (let index = 0; index < unique.length; index += MAX_BATCH) {
    const batch = unique.slice(index, index + MAX_BATCH);
    const path = `/tokens/v1/${CHAIN}/${batch.map(encodeURIComponent).join(',')}`;
    const pairs = parseBasePairs(await cachedJson<unknown>(path));
    output.push(...filterBasePairsForTokens(pairs, batch));
  }
  return output;
}

/** Choose one priced, liquid market per token: liquidity first, volume as tie-breaker. */
export function bestBasePairPerToken(pairs: BasePair[]): Map<string, BasePair> {
  const selected = new Map<string, BasePair>();
  for (const pair of pairs) {
    if (pair.priceUsd === null || pair.priceUsd <= 0 || pair.liquidityUsd <= 0) continue;
    const key = pair.baseToken.address.toLowerCase();
    const previous = selected.get(key);
    if (!previous ||
        pair.liquidityUsd > previous.liquidityUsd ||
        (pair.liquidityUsd === previous.liquidityUsd && pair.volume24hUsd > previous.volume24hUsd)) {
      selected.set(key, pair);
    }
  }
  return selected;
}

/** Bounded end-to-end read-only snapshot of discovered Base markets. */
export async function fetchBaseMarketSnapshot(limit = 30): Promise<BasePair[]> {
  const requested = Number.isFinite(limit) ? Math.floor(limit) : 30;
  const max = Math.max(1, Math.min(MAX_DISCOVERY_TOKENS, requested));
  const tokens = await discoverBaseTokens();
  const pairs = await fetchBasePairsForTokens(tokens.slice(0, max).map(token => token.address));
  return [...bestBasePairPerToken(pairs).values()]
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd || b.volume24hUsd - a.volume24hUsd);
}
