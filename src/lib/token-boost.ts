/**
 * Token Boost: paid promotion of a token on the Signals board (like DexScreener boosts).
 *
 * DISPLAY ONLY. A boost changes where a token is shown on the board and adds a labelled "Boosted" tag.
 * It must never influence the trading engine. This module (and listing-store) must not be imported by
 * the engine, gate, scorecard, executor or workers; tests/token-boost.test.ts walks the import graph to
 * enforce it. Real payment collection is disabled unless BOOST_PAYMENTS_ENABLED === 'true' AND a payment
 * provider is wired (none is yet).
 */
import type { ListingNetwork } from './verified';

export type BoostTierId = '12h' | '24h' | '7d';
export interface BoostTier { id: BoostTierId; label: string; hours: number; /** null = price not set yet (owner decision pending). */ priceUsd: number | null }
export const BOOST_TIERS: BoostTier[] = [
  { id: '12h', label: '12 hours', hours: 12, priceUsd: null },
  { id: '24h', label: '24 hours', hours: 24, priceUsd: null },
  { id: '7d', label: '7 days', hours: 24 * 7, priceUsd: null },
];
export const tierById = (id: string) => BOOST_TIERS.find((t) => t.id === id) ?? null;
export const BOOST_DISCLOSURE = 'Boosted placement is paid promotion. It is not a Cletus signal, rating or recommendation and has no effect on what Cletus trades. Boosted tokens must pass basic automated safety checks, which can be wrong. Do your own research.';
export const MAX_ACTIVE_BOOSTS_PER_TOKEN = 3;

export interface BoostRecord {
  id: string;
  network: ListingNetwork;
  token: string;
  tier: BoostTierId;
  startsAt: string;
  expiresAt: string;
  source: 'owner_grant' | 'paid';
  status: 'active' | 'cancelled';
  createdBy: string;
  note: string | null;
  createdAt: string;
}

export function boostPaymentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.BOOST_PAYMENTS_ENABLED === 'true';
}

/** Boosts stack: a new boost on a token that is already boosted starts when the current one ends. */
export function boostWindow(tier: BoostTier, existing: Pick<BoostRecord, 'expiresAt' | 'status'>[], now = new Date()): { startsAt: Date; expiresAt: Date } {
  const latest = existing.filter((b) => b.status === 'active').map((b) => new Date(b.expiresAt).getTime()).filter((t) => t > now.getTime()).sort((a, b) => b - a)[0];
  const startsAt = new Date(latest ?? now.getTime());
  return { startsAt, expiresAt: new Date(startsAt.getTime() + tier.hours * 3_600_000) };
}

export function isBoostActive(b: Pick<BoostRecord, 'status' | 'startsAt' | 'expiresAt'>, now = Date.now()): boolean {
  return b.status === 'active' && new Date(b.startsAt).getTime() <= now && new Date(b.expiresAt).getTime() > now;
}

export interface BoostSummary { network: ListingNetwork; token: string; expiresAt: string; tier: BoostTierId; checkedAt?: string | null }
/** One entry per boosted token (latest expiry wins), soonest-started first. Expired / future / cancelled are dropped. */
export function activeBoostSummaries(all: BoostRecord[], now = Date.now()): BoostSummary[] {
  const by = new Map<string, BoostRecord[]>();
  for (const b of all) {
    const key = `${b.network}:${b.token}`;
    by.set(key, [...(by.get(key) ?? []), b]);
  }
  const out: Array<BoostSummary & { startedAt: number }> = [];
  for (const list of Array.from(by.values())) {
    const live = list.find((b) => isBoostActive(b, now));
    if (!live) continue;
    // Chain stacked boosts: the visible expiry is the end of the contiguous run.
    let end = new Date(live.expiresAt).getTime();
    for (const b of list.filter((x) => x.status === 'active').sort((a, z) => +new Date(a.startsAt) - +new Date(z.startsAt))) {
      if (new Date(b.startsAt).getTime() <= end && new Date(b.expiresAt).getTime() > end) end = new Date(b.expiresAt).getTime();
    }
    out.push({ network: live.network, token: live.token, tier: live.tier, expiresAt: new Date(end).toISOString(), startedAt: new Date(live.startsAt).getTime() });
  }
  return out.sort((a, b) => a.startedAt - b.startedAt).map(({ startedAt: _s, ...rest }) => rest);
}

export interface SafetyInput { mintAuthority?: string | null; freezeAuthority?: string | null; ownerCanMint?: boolean | null; liquidityUsd: number | null; honeypot: boolean | null; sellTaxPct: number | null; buyTaxPct?: number | null; network: ListingNetwork }
/** Basic safety gate for boosting. Unknown required facts fail closed. */
export function boostSafety(f: SafetyInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (f.network === 'solana') {
    if (f.mintAuthority === undefined || f.freezeAuthority === undefined) reasons.push('Mint account could not be read.');
    if (f.mintAuthority) reasons.push('Mint authority is still active.');
    if (f.freezeAuthority) reasons.push('Freeze authority is still active.');
  } else {
    if (f.ownerCanMint == null) reasons.push('Contract privileges could not be read.');
    if (f.ownerCanMint) reasons.push('Owner can mint or change balances.');
  }
  if (f.liquidityUsd == null) reasons.push('No DEX pool found.');
  else if (f.liquidityUsd < 10_000) reasons.push('Liquidity is under $10,000.');
  if (f.honeypot === true) reasons.push('Flagged as a honeypot.');
  else if (f.network !== 'solana' && f.honeypot == null) reasons.push('Honeypot check could not be read.');
  if (f.sellTaxPct == null) { if (f.network !== 'solana') reasons.push('Sell tax could not be read.'); }
  else if (f.sellTaxPct > 10) reasons.push('Sell tax is over 10%.');
  if (f.buyTaxPct == null) { if (f.network !== 'solana') reasons.push('Buy tax could not be read.'); }
  else if (f.buyTaxPct > 10) reasons.push('Buy tax is over 10%.');
  return { ok: reasons.length === 0, reasons };
}

/** Board placement: boosted cards first (in boost order) in their own row; the main grid is unchanged. */
export function splitBoosted<T extends { mint: string }>(cards: T[], boosts: BoostSummary[], network: ListingNetwork = 'solana'): { boosted: T[]; rest: T[] } {
  const order = boosts.filter((b) => b.network === network).map((b) => b.token);
  const set = new Set(order);
  const boosted = order.map((m) => cards.find((c) => c.mint === m)).filter((c): c is T => !!c);
  return { boosted, rest: cards.filter((c) => !set.has(c.mint)) };
}
