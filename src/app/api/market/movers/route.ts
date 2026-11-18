import { NextResponse } from 'next/server';
import { getMovers } from '@/lib/movers-server';
export const dynamic = 'force-dynamic';

/** Public, read-only Solana movers board (DexScreener). No account data. */
export async function GET() {
  try {
    const data = await getMovers();
    return NextResponse.json({ ...data, chain: 'solana', note: 'Market data only. Not a recommendation.' }, { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } });
  } catch (e) {
    return NextResponse.json({ error: 'market_data_unavailable', message: e instanceof Error ? e.message : 'unavailable', tokens: [], fetchedAt: null }, { status: 502 });
  }
}
