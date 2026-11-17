import { NextResponse } from 'next/server';
import { fetchSolanaPairs } from '@/lib/movers-server';
import { bestPairs, toMoverCard } from '@/lib/movers';
import { BASE58_MINT } from '@/lib/public-audit';
export const dynamic = 'force-dynamic';

/** Public quote for up to 30 Solana mints (comma-separated). Used for paper-trade marks. */
export async function GET(req: Request) {
  const mints = (new URL(req.url).searchParams.get('mints') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!mints.length || mints.length > 30 || !mints.every((m) => BASE58_MINT.test(m))) return NextResponse.json({ error: 'invalid_mints' }, { status: 400 });
  try {
    const best = bestPairs(await fetchSolanaPairs([...new Set(mints)]));
    return NextResponse.json({ fetchedAt: new Date().toISOString(), tokens: [...best.values()].map((p) => toMoverCard(p)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: 'market_data_unavailable', message: e instanceof Error ? e.message : 'unavailable' }, { status: 502 });
  }
}
