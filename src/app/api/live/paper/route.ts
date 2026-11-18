import { NextResponse } from 'next/server';
import { loadPaperSnapshot } from '@/lib/paper-snapshot';

export const dynamic = 'force-dynamic';

/** Public, read-only Cletus paper (simulated) book. Never includes keys, wallets or live trades. */
export async function GET() {
  const snap = await loadPaperSnapshot();
  return NextResponse.json(snap, { headers: { 'cache-control': 'public, s-maxage=20, stale-while-revalidate=40' } });
}
