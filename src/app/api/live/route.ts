import { NextResponse } from 'next/server';
import { booksFromMaybeMixed, buildPublicBooks, mergeRecorded, recordedFromClosedPositions, recordedFromLiveEvents, type PublicLiveStats } from '@/lib/public-live';
import { readLiveTrades } from '@/lib/live-trades';
import { loadOwnerState, snapshotAgeMs } from '@/lib/owner-store';
import { isDemo } from '@/lib/demo';

export const dynamic = 'force-dynamic';

export type PublicLiveResponse = PublicLiveStats & { simulation: PublicLiveStats };

function pack(books: { live: PublicLiveStats; simulation: PublicLiveStats }): PublicLiveResponse {
  return { ...books.live, hasSimulationHistory: books.simulation.hasData, simulation: books.simulation };
}

/**
 * Public anonymized performance feed. Defaults to the LIVE book only
 * (non-simulated trades from 2026-11-11 12:23 PM America/Chicago onward).
 * Paper/sim history is attached as `simulation`. Never fabricates numbers.
 */
export async function GET() {
  try {
    const fromSnap = publicBooksFromSnapshot();
    const fromBox = await publicBooksFromBoxRecords().catch(() => null);
    const books = fromBox ?? fromSnap ?? booksFromMaybeMixed(null);
    return NextResponse.json(pack(books), { headers: { 'cache-control': 'public, s-maxage=5, stale-while-revalidate=15' } });
  } catch (e) {
    console.error('[cletus] public live', (e as Error)?.message);
    const empty = pack(booksFromMaybeMixed(null));
    return NextResponse.json(empty, { headers: { 'cache-control': 'no-store' } });
  }
}

function publicBooksFromSnapshot(): { live: PublicLiveStats; simulation: PublicLiveStats } | null {
  const s = loadOwnerState();
  const age = snapshotAgeMs(s);
  const payload = s.snapshot?.payload as { publicLive?: PublicLiveStats; publicLiveSimulation?: PublicLiveStats } | null;
  if (!payload?.publicLive || (age !== null && age >= 10 * 60_000)) return null;
  if (payload.publicLive.book === 'live' && payload.publicLiveSimulation) {
    return { live: payload.publicLive, simulation: payload.publicLiveSimulation };
  }
  return booksFromMaybeMixed(payload.publicLive);
}

async function publicBooksFromBoxRecords(): Promise<{ live: PublicLiveStats; simulation: PublicLiveStats } | null> {
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
  const recorded = mergeRecorded(fromDb, fromLog);
  if (!recorded.length && !events.length) return null;
  return buildPublicBooks(recorded);
}
