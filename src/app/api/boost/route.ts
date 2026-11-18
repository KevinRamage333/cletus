import { NextResponse } from 'next/server';
import { listBoosts } from '@/lib/listing-store';
import { BOOST_DISCLOSURE, BOOST_TIERS, activeBoostSummaries, boostPaymentsEnabled } from '@/lib/token-boost';
import { recheckListing } from '@/lib/listing-recheck';
export const dynamic = 'force-dynamic';

/** Public: boost tiers, whether paid boosts are open, and the tokens currently boosted. */
export async function GET() {
  const now = Date.now();
  // Boosted tokens are re-checked (~1h cache): liquidity under $10k, honeypot/tax or an authority change drops the placement.
  const checked = await Promise.all(activeBoostSummaries(await listBoosts(), now).slice(0, 50).map(async (b) => ({ b, c: await recheckListing(b.network, b.token, now) })));
  const boosts = checked.filter((x) => x.c.ok).map((x) => ({ ...x.b, checkedAt: x.c.checkedAt }));
  return NextResponse.json({ tiers: BOOST_TIERS, paymentsEnabled: boostPaymentsEnabled(), boosts, disclosure: BOOST_DISCLOSURE }, { headers: { 'Cache-Control': 'no-store' } });
}
