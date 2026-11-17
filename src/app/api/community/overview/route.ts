import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { collectivePnl, tokensPerNetwork } from '@/lib/community-overview';
import { MIN_ACCOUNTS_PER_POINT, cumulativePnlSeries } from '@/lib/live-chart';
export const dynamic = 'force-dynamic';

async function communityMostTraded(top: Array<{ mint: string; _count: { _all: number } }>) {
  const best = top[0];
  if (!best) return null;
  const [members, sym] = await Promise.all([
    prisma.position.findMany({ where: { account: { userId: { not: null }, labPreset: null }, simulated: true, network: 'solana', mint: best.mint }, distinct: ['accountId'], select: { accountId: true } }),
    prisma.position.findFirst({ where: { mint: best.mint, NOT: { symbol: '' } }, select: { symbol: true }, orderBy: { openedAt: 'desc' } }),
  ]);
  if (members.length < MIN_ACCOUNTS_PER_POINT) return null;
  return { mint: best.mint, symbol: sym?.symbol || best.mint.slice(0, 4), trades: best._count._all };
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
      // Exact counts over all paper positions (no take cap), most traded Solana token first.
      prisma.position.groupBy({ by: ['mint'], where: { ...paper, network: 'solana' }, _count: { _all: true }, orderBy: { _count: { mint: 'desc' } }, take: 1 }),
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
      mostTraded: pnl.suppressed ? null : await communityMostTraded(recent as Array<{ mint: string; _count: { _all: number } }>),
      tokensPerNetwork: tokensPerNetwork(tokenRows),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
