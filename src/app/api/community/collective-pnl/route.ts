import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
export const dynamic = 'force-dynamic';

/** Aggregate realized PnL for participating users' paper accounts only. No individual data is returned. */
export async function GET() {
  try {
    await requireOnboardedUser();
    const paperUserAccount = {
      account: { userId: { not: null }, labPreset: null },
      simulated: true,
    };
    const closedPaperTrade = { ...paperUserAccount, status: 'closed' };
    const [g, l, active] = await Promise.all([
      prisma.position.aggregate({
        where: { ...closedPaperTrade, pnlUsd: { gt: 0 } },
        _sum: { pnlUsd: true },
        _count: true,
      }),
      prisma.position.aggregate({
        where: { ...closedPaperTrade, pnlUsd: { lt: 0 } },
        _sum: { pnlUsd: true },
        _count: true,
      }),
      prisma.position.findMany({
        where: {
          ...paperUserAccount,
          openedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
        },
        distinct: ['accountId'],
        select: { accountId: true },
      }),
    ]);
    const gains = g._sum.pnlUsd ?? 0;
    const losses = Math.abs(l._sum.pnlUsd ?? 0);
    return NextResponse.json({
      netProfit: gains - losses,
      totalGains: gains,
      totalLosses: losses,
      winningTrades: g._count,
      losingTrades: l._count,
      activeUsers: active.length,
      mode: 'paper',
      updatedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (e) {
    return errorResponse(e);
  }
}
