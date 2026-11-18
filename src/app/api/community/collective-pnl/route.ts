import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { COLLECTIVE_PRIVACY_THRESHOLD, collectiveFiguresVisible } from '@/lib/community-feed';
export const dynamic = 'force-dynamic';

const HIDDEN = 'Collective financial metrics are hidden until at least five accounts opt in. Your opt-in status is still visible. No individual account, position, or wallet data is exposed.';
const SHOWN = 'Aggregates opted-in paper accounts only. At least five participating accounts are required before cohort metrics are displayed. Individual accounts, positions, and wallet balances are never returned. Paper results are simulations, not live returns.';

/** Opted-in paper accounts only. Figures are null until five accounts have opted in. */
export async function GET() {
  try {
    const user = await requireOnboardedUser();
    const [optedInAccounts, mine] = await Promise.all([
      prisma.communityOptIn.count({ where: { optedIn: true } }),
      prisma.communityOptIn.findUnique({ where: { userId: user.id }, select: { optedIn: true } }),
    ]);
    const updatedAt = new Date().toISOString();
    const base = {
      mode: 'paper' as const,
      privacyThreshold: COLLECTIVE_PRIVACY_THRESHOLD,
      optedIn: mine?.optedIn === true,
      updatedAt,
    };
    if (!collectiveFiguresVisible(optedInAccounts)) {
      return NextResponse.json({
        ...base,
        suppressed: true,
        netProfit: null,
        totalGains: null,
        totalLosses: null,
        winningTrades: null,
        losingTrades: null,
        activeUsers: null,
        methodology: HIDDEN,
      }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
    }
    const optedInPaper = {
      account: { userId: { not: null }, labPreset: null, user: { communityOptIn: { is: { optedIn: true } } } },
      simulated: true,
    };
    const [gains, losses, active] = await Promise.all([
      prisma.position.aggregate({ where: { ...optedInPaper, status: 'closed', pnlUsd: { gt: 0 } }, _sum: { pnlUsd: true }, _count: true }),
      prisma.position.aggregate({ where: { ...optedInPaper, status: 'closed', pnlUsd: { lt: 0 } }, _sum: { pnlUsd: true }, _count: true }),
      prisma.position.findMany({
        where: { ...optedInPaper, openedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
        distinct: ['accountId'],
        select: { accountId: true },
      }),
    ]);
    const totalGains = gains._sum.pnlUsd ?? 0;
    const totalLosses = Math.abs(losses._sum.pnlUsd ?? 0);
    return NextResponse.json({
      ...base,
      suppressed: false,
      netProfit: totalGains - totalLosses,
      totalGains,
      totalLosses,
      winningTrades: gains._count,
      losingTrades: losses._count,
      activeUsers: active.length,
      methodology: SHOWN,
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (e) {
    return errorResponse(e);
  }
}
