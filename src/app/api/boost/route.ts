import { NextResponse } from 'next/server';
import { listBoosts } from '@/lib/listing-store';
import { BOOST_DISCLOSURE, BOOST_TIERS, activeBoostSummaries, boostPaymentsEnabled } from '@/lib/token-boost';
export const dynamic = 'force-dynamic';

/** Public: boost tiers, whether paid boosts are open, and the tokens currently boosted. */
export async function GET() {
  const boosts = activeBoostSummaries(await listBoosts());
  return NextResponse.json({ tiers: BOOST_TIERS, paymentsEnabled: boostPaymentsEnabled(), boosts, disclosure: BOOST_DISCLOSURE }, { headers: { 'Cache-Control': 'no-store' } });
}
