import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { publishedCommunityPnl, tokensPerNetwork } from '@/lib/community-overview';
import { communityPaperScope, distinctPeople, flooredCount } from '@/lib/community-scope';
import { MIN_ACCOUNTS_PER_POINT } from '@/lib/live-chart';
export const dynamic = 'force-dynamic';

type Scope = ReturnType<typeof communityPaperScope>;

async function communityMostTraded(scope: Scope, top: Array<{ mint: string; _count: { _all: number } }>) {
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
 * P&L figures are whole dollars and only change when a new bucket of 5+ members is published.
 */
export async function GET() {
  try {
    await requireOnboardedUser();
    const scope = communityPaperScope();
    const person = { account: { select: { userId: true } } } as const;
    const [participantRows, activeRows, closed, tokenRows, recent] = await Promise.all([
      prisma.position.findMany({ where: scope, distinct: ['accountId'], select: person }),
      prisma.position.findMany({ where: { ...scope, status: 'open' }, distinct: ['accountId'], select: person }),
      prisma.position.findMany({ where: { ...scope, status: 'closed', pnlUsd: { not: null } }, select: { pnlUsd: true, accountId: true, closedAt: true } }),
      prisma.position.findMany({ where: scope, distinct: ['network', 'mint'], select: { network: true, mint: true } }),
      // Exact counts over the scoped paper positions (no take cap), most traded Solana token first.
      prisma.position.groupBy({ by: ['mint'], where: { ...scope, network: 'solana' }, _count: { _all: true }, orderBy: { _count: { mint: 'desc' } }, take: 1 }),
    ]);
    const participants = distinctPeople(participantRows);
    // Totals, split and chart all come from the same published buckets (L-103a).
    const pnl = publishedCommunityPnl(closed);
    return NextResponse.json({
      connected: true, mode: 'paper', updatedAt: new Date().toISOString(),
      participants: flooredCount(participants),
      activeNow: flooredCount(distinctPeople(activeRows)),
      collectivePnl: pnl.suppressed
        ? { suppressed: true, minContributors: pnl.minContributors }
        : { suppressed: false, netUsd: pnl.netUsd, gainsUsd: pnl.gainsUsd, lossesUsd: pnl.lossesUsd, winningTrades: pnl.winningTrades, losingTrades: pnl.losingTrades, closedTrades: pnl.closedTrades },
      // Each daily point covers >= 5 distinct members (quiet days roll forward); the last point equals netUsd.
      pnlSeries: pnl.series,
      // Hidden with the totals, and only shown when enough distinct members traded it.
      mostTraded: pnl.suppressed ? null : await communityMostTraded(scope, recent as Array<{ mint: string; _count: { _all: number } }>),
      // Token counts are only published once the group itself is large enough.
      tokensPerNetwork: participants >= MIN_ACCOUNTS_PER_POINT ? tokensPerNetwork(tokenRows) : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
