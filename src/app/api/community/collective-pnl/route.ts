import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
export const dynamic = 'force-dynamic';
/** Aggregate realized PnL of all beta testers' paper accounts (no individual data). */
export async function GET() {
  try {
    await requireOnboardedUser();
    const where = { status: 'closed', account: { userId: { not: null }, labPreset: null } };
    const [g, l, active] = await Promise.all([
      prisma.position.aggregate({ where: { ...where, pnlUsd: { gt: 0 } }, _sum: { pnlUsd: true }, _count: true }),
      prisma.position.aggregate({ where: { ...where, pnlUsd: { lt: 0 } }, _sum: { pnlUsd: true }, _count: true }),
      prisma.position.findMany({ where: { account: { userId: { not: null } }, openedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, distinct: ['accountId'], select: { accountId: true } }),
    ]);
    const gains = g._sum.pnlUsd ?? 0, losses = Math.abs(l._sum.pnlUsd ?? 0);
    return NextResponse.json({ netProfit: gains - losses, totalGains: gains, totalLosses: losses, winningTrades: g._count, losingTrades: l._count, activeUsers: active.length, mode: 'paper', updatedAt: new Date().toISOString() });
  } catch (e) { return errorResponse(e); }
}
