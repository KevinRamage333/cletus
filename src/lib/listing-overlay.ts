import type { VerificationRecord } from './listing-store';
import { activeBoostSummaries, type BoostRecord, type BoostSummary } from './token-boost';
import { isBadgeActive, latestRecordByToken, type ListingNetwork } from './verified';
import type { RecheckResult } from './listing-recheck';

export const LISTING_OVERLAY_CAP = 50;
type Recheck = (network: ListingNetwork, token: string, now: number) => Promise<RecheckResult>;

/**
 * Public listing overlay (Signals board, token pages, audit screen). Same rules as /api/verified and /api/boost:
 * latest record per token wins (a newer failed audit hides an older badge), only active badges/boosts,
 * capped at 50, and each one must pass a live re-check (~1h cache) to stay visible (Audit B1).
 */
export async function listingOverlay(ver: VerificationRecord[], raw: BoostRecord[], now: number, recheck: Recheck): Promise<{ verified: string[]; boosts: BoostSummary[] }> {
  const latest = latestRecordByToken(ver).filter((r) => isBadgeActive(r, now)).slice(0, LISTING_OVERLAY_CAP);
  const boosts = activeBoostSummaries(raw, now).slice(0, LISTING_OVERLAY_CAP);
  const [vChecked, bChecked] = await Promise.all([
    Promise.all(latest.map(async (r) => ({ r, c: await recheck(r.network as ListingNetwork, r.token, now) }))),
    Promise.all(boosts.map(async (b) => ({ b, c: await recheck(b.network, b.token, now) }))),
  ]);
  return {
    verified: Array.from(new Set(vChecked.filter((x) => x.c.ok).map((x) => `${x.r.network}:${x.r.token}`))),
    boosts: bChecked.filter((x) => x.c.ok).map((x) => ({ ...x.b, checkedAt: x.c.checkedAt })),
  };
}
