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
    const [g, l, contributors, active] = await Promise.all([
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
        where: closedPaperTrade,
        distinct: ['accountId'],
        select: { accountId: true },
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
    // A single account's realized results must not be inferable from a community aggregate.
    // A seven-day activity count is not the same as the number of P&L contributors.
    if (contributors.length < 5) return NextResponse.json({
      suppressed: true,
      minContributors: 5,
      mode: 'paper',
      period: 'all_time_realized',
      updatedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
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
      period: 'all_time_realized',
      suppressed: false,
      contributors: contributors.length,
      updatedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (e) {
    return errorResponse(e);
  }
}
