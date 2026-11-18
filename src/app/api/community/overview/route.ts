import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { collectivePnl, tokensPerNetwork } from '@/lib/community-overview';
import { COMMUNITY_PAPER_SCOPE, distinctPeople, flooredCount } from '@/lib/community-scope';
import { MIN_ACCOUNTS_PER_POINT, cumulativePnlSeries } from '@/lib/live-chart';
export const dynamic = 'force-dynamic';

const scope = COMMUNITY_PAPER_SCOPE;

async function communityMostTraded(top: Array<{ mint: string; _count: { _all: number } }>) {
  const best = top[0];
  if (!best) return null;
  const [members, sym] = await Promise.all([
    prisma.position.findMany({ where: { ...scope, network: 'solana', mint: best.mint }, distinct: ['accountId'], select: { account: { select: { userId: true } } } }),
    prisma.position.findFirst({ where: { ...scope, mint: best.mint, NOT: { symbol: '' } }, select: { symbol: true }, orderBy: { openedAt: 'desc' } }),
  ]);
  if (distinctPeople(members) < MIN_ACCOUNTS_PER_POINT) return null;
  return { mint: best.mint, symbol: sym?.symbol || best.mint.slice(0, 4), trades: best._count._all };
}

/**
 * Aggregate community figures from recorded paper trades of opted-in, non-banned members only
 * (the same scope as /api/community/collective-pnl). Every count and P&L figure needs at least
 * five distinct people behind it; below that it is null (hidden), never a small number or $0.
 */
export async function GET() {
  try {
    await requireOnboardedUser();
    const person = { account: { select: { userId: true } } } as const;
    const [participantRows, activeRows, closed, tokenRows, recent] = await Promise.all([
      prisma.position.findMany({ where: scope, distinct: ['accountId'], select: person }),
      prisma.position.findMany({ where: { ...scope, status: 'open' }, distinct: ['accountId'], select: person }),
      prisma.position.findMany({ where: { ...scope, status: 'closed', pnlUsd: { not: null } }, select: { pnlUsd: true, accountId: true, closedAt: true, account: { select: { userId: true } } } }),
      prisma.position.findMany({ where: scope, distinct: ['network', 'mint'], select: { network: true, mint: true } }),
      // Exact counts over the scoped paper positions (no take cap), most traded Solana token first.
      prisma.position.groupBy({ by: ['mint'], where: { ...scope, network: 'solana' }, _count: { _all: true }, orderBy: { _count: { mint: 'desc' } }, take: 1 }),
    ]);
    const participants = distinctPeople(participantRows);
    const contributors = distinctPeople(closed);
    const pnl = collectivePnl(closed.map((c) => c.pnlUsd), contributors);
    return NextResponse.json({
      connected: true, mode: 'paper', updatedAt: new Date().toISOString(),
      participants: flooredCount(participants),
      activeNow: flooredCount(distinctPeople(activeRows)),
      collectivePnl: pnl,
      // Same privacy floor as the total: no curve until enough members contribute.
      // Each daily point must cover >= MIN_ACCOUNTS_PER_POINT distinct members (quiet days roll forward).
      pnlSeries: pnl.suppressed ? [] : cumulativePnlSeries(closed, 86_400, MIN_ACCOUNTS_PER_POINT),
      // Hidden with the totals, and only shown when enough distinct members traded it.
      mostTraded: pnl.suppressed ? null : await communityMostTraded(recent as Array<{ mint: string; _count: { _all: number } }>),
      // Token counts are only published once the group itself is large enough.
      tokensPerNetwork: participants >= MIN_ACCOUNTS_PER_POINT ? tokensPerNetwork(tokenRows) : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
