import { NextResponse } from 'next/server';
import { buildPublicLiveStats, EMPTY_PUBLIC_LIVE, mergeRecorded, recordedFromClosedPositions, recordedFromLiveEvents } from '@/lib/public-live';
import { readLiveTrades } from '@/lib/live-trades';
import { loadOwnerState, snapshotAgeMs } from '@/lib/owner-store';
import { isDemo } from '@/lib/demo';

export const dynamic = 'force-dynamic';

/**
 * Public anonymized performance feed. Only recorded trades. Never fabricates
 * demo/illustrative numbers. Empty book → hasData=false.
 */
export async function GET() {
  try {
    const fromSnap = publicFromSnapshot();
    const fromBox = await publicFromBoxRecords().catch(() => null);
    // Prefer a fresh box computation when we can actually read records; otherwise a pushed snapshot.
    const stats = fromBox?.hasData ? fromBox : (fromSnap?.hasData ? fromSnap : (fromBox ?? fromSnap ?? { ...EMPTY_PUBLIC_LIVE, asOf: new Date().toISOString() }));
    return NextResponse.json(stats, { headers: { 'cache-control': 'public, s-maxage=5, stale-while-revalidate=15' } });
  } catch (e) {
    console.error('[cletus] public live', (e as Error)?.message);
    return NextResponse.json({ ...EMPTY_PUBLIC_LIVE, asOf: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } });
  }
}

function publicFromSnapshot() {
  const s = loadOwnerState();
  const age = snapshotAgeMs(s);
  const payload = s.snapshot?.payload as { publicLive?: ReturnType<typeof buildPublicLiveStats> } | null;
  if (payload?.publicLive && (age === null || age < 10 * 60_000)) return payload.publicLive;
  return null;
}

async function publicFromBoxRecords() {
  if (isDemo()) return null;
  const events = readLiveTrades();
  const fromLog = recordedFromLiveEvents(events, true);
  let fromDb = [] as ReturnType<typeof recordedFromClosedPositions>;
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('file:')) {
    try {
      const { prisma } = await import('@/lib/db');
      const rows = await prisma.position.findMany({
        where: { status: 'closed' },
        orderBy: { closedAt: 'desc' },
        take: 200,
        include: { account: { select: { isOperator: true, user: { select: { walletPublicKey: true, displayName: true } } } } },
      });
      fromDb = recordedFromClosedPositions(rows.map((p) => ({
        id: p.id, symbol: p.symbol, closedAt: p.closedAt, pnlUsd: p.pnlUsd, pnlPct: p.pnlPct,
        exitTx: p.exitTx, entryTx: p.entryTx, simulated: p.simulated,
        isOperator: p.account.isOperator,
        // No opt-in column yet: never show a wallet on the public feed.
        optedInLabel: null, showWallet: false, wallet: null,
      })));
    } catch { /* no db */ }
  }
  return buildPublicLiveStats(mergeRecorded(fromDb, fromLog));
}
