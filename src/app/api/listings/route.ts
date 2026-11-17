import { NextResponse } from 'next/server';
import { listBoosts, listVerifications } from '@/lib/listing-store';
import { fetchSolanaPairs } from '@/lib/movers-server';
import { bestPairs, toMoverCard, type MoverCard } from '@/lib/movers';
import { activeBoostSummaries } from '@/lib/token-boost';
import { isBadgeActive } from '@/lib/verified';
export const dynamic = 'force-dynamic';

/**
 * Public, display-only listing overlay for the Signals board, token pages and audit screen:
 * which tokens are Cletus Verified, which are Boosted (with market cards for boosted Solana tokens).
 */
export async function GET(req: Request) {
  const withCards = new URL(req.url).searchParams.get('cards') === '1';
  const [ver, raw] = await Promise.all([listVerifications(), listBoosts()]);
  const now = Date.now();
  const verified = Array.from(new Set(ver.filter((r) => isBadgeActive(r, now)).map((r) => `${r.network}:${r.token}`)));
  const boosts = activeBoostSummaries(raw, now);
  let boostedCards: MoverCard[] = [];
  const mints = boosts.filter((b) => b.network === 'solana').map((b) => b.token);
  if (withCards && mints.length) {
    try { const best = bestPairs(await fetchSolanaPairs(mints)); boostedCards = mints.map((m) => best.get(m)).filter((p): p is NonNullable<typeof p> => !!p).map((p) => ({ ...toMoverCard(p), boosted: false })); } catch { boostedCards = []; }
  }
  return NextResponse.json({ verified, boosts, boostedCards, at: new Date(now).toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
