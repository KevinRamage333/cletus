import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { collectivePnl, tokensPerNetwork } from '@/lib/community-overview';
export const dynamic = 'force-dynamic';

/** Aggregate community figures from recorded paper trades: participants, collective realized P&L, distinct tokens per network. */
export async function GET() {
  try {
    await requireOnboardedUser();
    const paper = { account: { userId: { not: null }, labPreset: null }, simulated: true };
    const [participants, active, closed, tokenRows] = await Promise.all([
      prisma.position.findMany({ where: paper, distinct: ['accountId'], select: { accountId: true } }),
      prisma.position.findMany({ where: { ...paper, status: 'open' }, distinct: ['accountId'], select: { accountId: true } }),
      prisma.position.findMany({ where: { ...paper, status: 'closed' }, select: { pnlUsd: true, accountId: true } }),
      prisma.position.findMany({ where: paper, distinct: ['network', 'mint'], select: { network: true, mint: true } }),
    ]);
    const contributors = new Set(closed.map((c) => c.accountId)).size;
    return NextResponse.json({
      connected: true, mode: 'paper', updatedAt: new Date().toISOString(),
      participants: participants.length, activeNow: active.length,
      collectivePnl: collectivePnl(closed.map((c) => c.pnlUsd), contributors),
      tokensPerNetwork: tokensPerNetwork(tokenRows),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
