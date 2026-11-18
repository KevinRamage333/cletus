import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { COLLECTIVE_PRIVACY_THRESHOLD, collectiveFiguresVisible } from '@/lib/community-feed';
export const dynamic = 'force-dynamic';

const HIDDEN = 'Collective financial metrics are hidden until at least five people have closed paper trades in the opted-in group. Your opt-in status is still visible. No individual account, position, or wallet data is exposed.';
const SHOWN = 'Aggregates closed paper trades from opted-in, non-muted members only. At least five people must have closed trades in the aggregate before any cohort metric is displayed. Individual accounts, positions, and wallet balances are never returned. Paper results are simulations, not live returns.';
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

/** Paper positions of opted-in, non-banned members (lab preset accounts excluded). */
const optedInPaper = {
  simulated: true,
  account: { labPreset: null, user: { is: { banned: false, communityOptIn: { is: { optedIn: true } } } } },
};

/**
 * The privacy threshold is checked on the people actually inside the aggregate
 * (distinct members with a closed trade that has a P&L), not on opt-ins.
 * Below the threshold every figure is null, including activeUsers.
 */
export async function GET() {
  try {
    const user = await requireOnboardedUser();
    const closed = { ...optedInPaper, status: 'closed', pnlUsd: { not: null } };
    const [contributorRows, mine] = await Promise.all([
      prisma.position.findMany({ where: closed, distinct: ['accountId'], select: { account: { select: { userId: true } } } }),
      prisma.communityOptIn.findUnique({ where: { userId: user.id }, select: { optedIn: true } }),
    ]);
    const contributors = new Set(contributorRows.map((r) => r.account.userId).filter((id): id is string => Boolean(id))).size;
    const base = {
      mode: 'paper' as const,
      privacyThreshold: COLLECTIVE_PRIVACY_THRESHOLD,
      optedIn: mine?.optedIn === true,
      updatedAt: new Date().toISOString(),
    };
    if (!collectiveFiguresVisible(contributors)) {
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
      }, { headers: NO_STORE });
    }
    const [gains, losses, active] = await Promise.all([
      prisma.position.aggregate({ where: { ...closed, pnlUsd: { gt: 0 } }, _sum: { pnlUsd: true }, _count: true }),
      prisma.position.aggregate({ where: { ...closed, pnlUsd: { lt: 0 } }, _sum: { pnlUsd: true }, _count: true }),
      prisma.position.findMany({
        where: { ...optedInPaper, openedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
        distinct: ['accountId'],
        select: { accountId: true },
      }),
    ]);
    // A sum over zero rows is a real 0 here: the contributor set is non-empty and each bucket is a filter on it.
    const totalGains = gains._sum.pnlUsd ?? 0;
    const totalLosses = Math.abs(losses._sum.pnlUsd ?? 0);
    // A small "active this week" count could single people out, so it gets the same threshold.
    const activeUsers = active.length >= COLLECTIVE_PRIVACY_THRESHOLD ? active.length : null;
    return NextResponse.json({
      ...base,
      suppressed: false,
      netProfit: totalGains - totalLosses,
      totalGains,
      totalLosses,
      winningTrades: gains._count,
      losingTrades: losses._count,
      activeUsers,
      methodology: SHOWN,
    }, { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e);
  }
}
