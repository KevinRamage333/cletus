/**
 * Public Solana "movers board" built from DexScreener's free public API (pump.fun-style token cards).
 * Pure helpers are unit-tested in tests/movers.test.ts. Missing values stay null — never coerced to 0.
 */
import type { DexPair } from './dexscreener';

export type PairWithInfo = DexPair & { info?: { imageUrl?: string; header?: string; websites?: Array<{ url: string }>; socials?: Array<{ type?: string; url: string }> } };
export interface ProfileEntry { chainId: string; tokenAddress: string; icon?: string; description?: string; url?: string }

export interface MoverCard {
  mint: string;
  pair: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  dex: string;
  url: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume5mUsd: number | null;
  volume1hUsd: number | null;
  volume24hUsd: number | null;
  change5mPct: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  buys1h: number | null;
  sells1h: number | null;
  createdAt: number | null;
  boosted: boolean;
}

export type MoverSort = 'movers' | 'new' | 'volume' | 'mcap';
export const MOVER_SORTS: Array<{ id: MoverSort; label: string }> = [
  { id: 'movers', label: 'Movers' }, { id: 'new', label: 'New' }, { id: 'volume', label: 'Volume' }, { id: 'mcap', label: 'Market cap' },
];

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export function toMoverCard(p: PairWithInfo, iconFallback?: string | null, boosted = false): MoverCard {
  return {
    mint: p.baseToken.address,
    pair: p.pairAddress,
    name: p.baseToken.name || p.baseToken.symbol || 'Unknown',
    symbol: p.baseToken.symbol || '?',
    imageUrl: p.info?.imageUrl ?? iconFallback ?? null,
    dex: p.dexId,
    url: p.url ?? null,
    priceUsd: num(p.priceUsd),
    marketCapUsd: num(p.marketCap ?? p.fdv),
    liquidityUsd: num(p.liquidity?.usd),
    volume5mUsd: num(p.volume?.m5),
    volume1hUsd: num(p.volume?.h1),
    volume24hUsd: num(p.volume?.h24),
    change5mPct: num(p.priceChange?.m5),
    change1hPct: num(p.priceChange?.h1),
    change24hPct: num(p.priceChange?.h24),
    buys1h: num(p.txns?.h1?.buys),
    sells1h: num(p.txns?.h1?.sells),
    createdAt: num(p.pairCreatedAt),
    boosted,
  };
}

/** Sort a copy. Cards missing the sort key always go last (unknown is not "zero"). */
export function sortMovers(cards: MoverCard[], sort: MoverSort): MoverCard[] {
  const key = (c: MoverCard): number | null => {
    switch (sort) {
      case 'movers': return c.change5mPct == null && c.change1hPct == null ? null : Math.abs(c.change5mPct ?? 0) * 3 + Math.abs(c.change1hPct ?? 0);
      case 'new': return c.createdAt;
      case 'volume': return c.volume1hUsd ?? c.volume24hUsd;
      case 'mcap': return c.marketCapUsd;
    }
  };
  return [...cards].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    return kb - ka;
  });
}

export function formatUsdCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  if (a >= 1) return `${s}$${a.toFixed(2)}`;
  if (a === 0) return '$0.00';
  return `${s}$${a.toPrecision(3)}`;
}
export function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  return `$${n.toPrecision(4)}`;
}
export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;
}
export function formatAge(createdAt: number | null | undefined, now = Date.now()): string {
  if (createdAt == null || !Number.isFinite(createdAt)) return '—';
  const s = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

/** Data freshness for UI states. */
export type Freshness = 'fresh' | 'stale' | 'unknown';
export function freshness(fetchedAtIso: string | null | undefined, now = Date.now(), staleAfterMs = 90_000): Freshness {
  const t = fetchedAtIso ? Date.parse(fetchedAtIso) : NaN;
  if (!Number.isFinite(t)) return 'unknown';
  return now - t > staleAfterMs ? 'stale' : 'fresh';
}

/** Best pair per mint: deepest liquidity, then 24h volume. Only pairs where the mint is the base token. */
export function bestPairs(pairs: PairWithInfo[], chainId = 'solana'): Map<string, PairWithInfo> {
  const out = new Map<string, PairWithInfo>();
  const score = (x: PairWithInfo) => (x.liquidity?.usd ?? 0) * 10 + (x.volume?.h24 ?? 0);
  for (const p of pairs) {
    if (p.chainId !== chainId || !p.baseToken?.address) continue;
    const prev = out.get(p.baseToken.address);
    if (!prev || score(p) > score(prev)) out.set(p.baseToken.address, p);
  }
  return out;
}
