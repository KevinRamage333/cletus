import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { collectivePnl, tokensPerNetwork } from '@/lib/community-overview';
import { MIN_ACCOUNTS_PER_POINT, cumulativePnlSeries, mostTradedToken } from '@/lib/live-chart';
export const dynamic = 'force-dynamic';

function communityMostTraded(rows: Array<{ network: string | null; mint: string; symbol: string | null; accountId: string }>) {
  const best = mostTradedToken(rows);
  if (!best) return null;
  const members = new Set(rows.filter((r) => r.mint === best.mint).map((r) => r.accountId)).size;
  return members >= MIN_ACCOUNTS_PER_POINT ? best : null;
}

/** Aggregate community figures from recorded paper trades: participants, collective realized P&L, distinct tokens per network. */
export async function GET() {
  try {
    await requireOnboardedUser();
    const paper = { account: { userId: { not: null }, labPreset: null }, simulated: true };
    const [participants, active, closed, tokenRows, recent] = await Promise.all([
      prisma.position.findMany({ where: paper, distinct: ['accountId'], select: { accountId: true } }),
      prisma.position.findMany({ where: { ...paper, status: 'open' }, distinct: ['accountId'], select: { accountId: true } }),
      prisma.position.findMany({ where: { ...paper, status: 'closed' }, select: { pnlUsd: true, accountId: true, closedAt: true } }),
      prisma.position.findMany({ where: paper, distinct: ['network', 'mint'], select: { network: true, mint: true } }),
      prisma.position.findMany({ where: paper, select: { network: true, mint: true, symbol: true, accountId: true }, orderBy: { openedAt: 'desc' }, take: 5000 }),
    ]);
    const contributors = new Set(closed.map((c) => c.accountId)).size;
    const pnl = collectivePnl(closed.map((c) => c.pnlUsd), contributors);
    return NextResponse.json({
      connected: true, mode: 'paper', updatedAt: new Date().toISOString(),
      participants: participants.length, activeNow: active.length,
      collectivePnl: pnl,
      // Same privacy floor as the total: no curve until enough members contribute.
      // Each daily point must cover >= MIN_ACCOUNTS_PER_POINT distinct members (quiet days roll forward).
      pnlSeries: pnl.suppressed ? [] : cumulativePnlSeries(closed, 86_400, MIN_ACCOUNTS_PER_POINT),
      // Hidden with the totals, and only shown when enough distinct members traded it.
      mostTraded: pnl.suppressed ? null : communityMostTraded(recent),
      tokensPerNetwork: tokensPerNetwork(tokenRows),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
