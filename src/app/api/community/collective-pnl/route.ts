import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { COLLECTIVE_PRIVACY_THRESHOLD, collectiveFiguresVisible } from '@/lib/community-feed';
import { communityPaperScope, ELIGIBILITY_SELECT, pnlRows } from '@/lib/community-scope';
import { publishedCommunityPnl } from '@/lib/community-overview';
export const dynamic = 'force-dynamic';

const HIDDEN = 'Collective financial metrics are hidden until at least five people have closed paper trades in the opted-in group. Your opt-in status is still visible. No individual account, position, or wallet data is exposed.';
const SHOWN = 'Aggregates closed paper trades from opted-in, non-muted members only. At least five people must have closed trades in the aggregate before any cohort metric is displayed, gains and losses are shown only when five or more people are on each side (otherwise both are hidden), and figures are whole dollars from finished UTC days only, so trades closed today are not included yet and figures change only when a new finished day with five or more members is published. Only trades closed after a member opted in and after their account was a week old are counted. Individual accounts, positions, and wallet balances are never returned. Paper results are simulations, not live returns.';
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

/**
 * The privacy threshold is checked on the people actually inside the aggregate
 * (distinct members with a closed trade that has a P&L), not on opt-ins.
 * Figures come from the same published daily buckets as the community chart (publishedCommunityPnl),
 * so they never differ from it by one member's trades; the gains/losses split is shown only when
 * both sides have 5+ people. Below the threshold every figure is null, including activeUsers.
 */
export async function GET() {
  try {
    const user = await requireOnboardedUser();
    const scope = communityPaperScope();
    const [closedRows, mine, active] = await Promise.all([
      prisma.position.findMany({ where: { ...scope, status: 'closed', pnlUsd: { not: null } }, select: { pnlUsd: true, accountId: true, closedAt: true, account: { select: ELIGIBILITY_SELECT } } }),
      prisma.communityOptIn.findUnique({ where: { userId: user.id }, select: { optedIn: true } }),
      prisma.position.findMany({
        where: { ...scope, openedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
        distinct: ['accountId'],
        select: { accountId: true },
      }),
    ]);
    const pnl = publishedCommunityPnl(pnlRows(closedRows), 86_400, COLLECTIVE_PRIVACY_THRESHOLD);
    const base = {
      mode: 'paper' as const,
      privacyThreshold: COLLECTIVE_PRIVACY_THRESHOLD,
      optedIn: mine?.optedIn === true,
      updatedAt: new Date().toISOString(),
    };
    if (pnl.suppressed || !collectiveFiguresVisible(pnl.contributors)) {
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
    // A small "active this week" count could single people out, so it gets the same threshold.
    const activeUsers = active.length >= COLLECTIVE_PRIVACY_THRESHOLD ? active.length : null;
    return NextResponse.json({
      ...base,
      suppressed: false,
      netProfit: pnl.netUsd,
      totalGains: pnl.gainsUsd,
      totalLosses: pnl.lossesUsd === null ? null : Math.abs(pnl.lossesUsd),
      winningTrades: pnl.winningTrades,
      losingTrades: pnl.losingTrades,
      activeUsers,
      methodology: SHOWN,
    }, { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e);
  }
}
