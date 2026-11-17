import { NextResponse } from 'next/server';
import { errorResponse, requireOnboardedUser } from '@/lib/auth';
import { fetchBaseMarketSnapshot } from '@/lib/base-market-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Authenticated, read-only Base market discovery. Candidates are not trading signals. */
export async function GET() {
  try {
    await requireOnboardedUser();
    const markets = await fetchBaseMarketSnapshot(25);
    return NextResponse.json({
      network: 'base',
      chainId: 8453,
      readOnly: true,
      candidatesAreSignals: false,
      updatedAt: new Date().toISOString(),
      markets,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
