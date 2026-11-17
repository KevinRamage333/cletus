/**
 * Re-checks of Cletus Verified badges and Token Boosts against fresh public facts (display only, never the engine).
 * Facts are cached 60s per token (shared by submit/check/boost routes) and a badge/boost recheck result for ~1h.
 * Per-instance memory: on Vercel each instance re-checks on its own, which only means extra reads, never a stale pass
 * older than RECHECK_TTL_MS.
 */
import { gatherTokenFacts } from './token-security-server';
import { RECHECK_TTL_MS, recheckDrops, tokenKey, type ListingNetwork, type TokenSecurityFacts } from './verified';

export const FACTS_TTL_MS = 60_000;
const facts = new Map<string, { at: number; p: Promise<TokenSecurityFacts> }>();
const rechecks = new Map<string, { at: number; drops: string[] }>();

/** gatherTokenFacts with a 60s per-token cache (in-flight requests are shared). Failed reads are not cached. */
export function cachedTokenFacts(network: ListingNetwork, token: string, now = Date.now(), gather = gatherTokenFacts): Promise<TokenSecurityFacts> {
  const k = tokenKey(network, token);
  const hit = facts.get(k);
  if (hit && now - hit.at < FACTS_TTL_MS) return hit.p;
  const p = gather(network, token);
  facts.set(k, { at: now, p });
  p.catch(() => { if (facts.get(k)?.p === p) facts.delete(k); });
  if (facts.size > 2000) for (const [key, v] of facts) if (now - v.at >= FACTS_TTL_MS) facts.delete(key);
  return p;
}

export interface RecheckResult { ok: boolean; drops: string[]; checkedAt: string | null }

/** Badge/boost still valid? Drops on low liquidity, honeypot/tax, or an authority/minting change. */
export async function recheckListing(network: ListingNetwork, token: string, now = Date.now(), gather = gatherTokenFacts): Promise<RecheckResult> {
  const k = tokenKey(network, token);
  const prev = rechecks.get(k);
  if (prev && now - prev.at < RECHECK_TTL_MS) return { ok: prev.drops.length === 0, drops: prev.drops, checkedAt: new Date(prev.at).toISOString() };
  try {
    const f = await cachedTokenFacts(network, token, now, gather);
    const drops = recheckDrops(f);
    rechecks.set(k, { at: now, drops });
    return { ok: drops.length === 0, drops, checkedAt: new Date(now).toISOString() };
  } catch {
    // Sources down: keep the last known result (if any) but never claim a fresh check.
    if (prev) return { ok: prev.drops.length === 0, drops: prev.drops, checkedAt: new Date(prev.at).toISOString() };
    return { ok: true, drops: [], checkedAt: null };
  }
}

/** Test hook. */
export function _resetListingCaches(): void { facts.clear(); rechecks.clear(); }
