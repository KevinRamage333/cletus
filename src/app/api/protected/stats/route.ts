import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { errorResponse } from '@/lib/auth';
import { appContext, runState } from '@/lib/app-api';
import { accountEquity } from '@/lib/engine';
import { computeScorecard } from '@/lib/scorecard';
import { trialInfo } from '@/lib/trial';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { u, a, e } = await appContext();
    const [eq, closed, last24] = await Promise.all([
      accountEquity(a),
      prisma.position.findMany({ where: { accountId: a.id, status: 'closed' }, select: { pnlUsd: true, pnlPct: true, closedAt: true, symbol: true } }),
      prisma.position.aggregate({ where: { accountId: a.id, status: 'closed', closedAt: { gte: new Date(Date.now() - 86_400_000) } }, _sum: { pnlUsd: true } }),
    ]);
    const sc = computeScorecard(closed.map((t) => ({ pnlUsd: t.pnlUsd ?? 0, pnlPct: t.pnlPct ?? 0, closedAt: t.closedAt ?? new Date() })), a.startingBalance);
    const unrealized = eq.open.reduce((s, p) => s + p.tokenAmount * p.lastPrice - p.sizeUsd - p.feesUsd, 0);
    const realized24 = last24._sum.pnlUsd ?? 0;
    const pnls = closed.map((t) => t.pnlUsd ?? 0);
    const best = closed.length ? closed.reduce((m, t) => ((t.pnlUsd ?? 0) > (m.pnlUsd ?? 0) ? t : m)) : null;
    const worst = closed.length ? closed.reduce((m, t) => ((t.pnlUsd ?? 0) < (m.pnlUsd ?? 0) ? t : m)) : null;
    return NextResponse.json({
      pnl24h: realized24 + unrealized, pnl24hRealized: realized24, unrealized, pnl24hPercent: a.startingBalance ? ((realized24 + unrealized) / a.startingBalance) * 100 : 0,
      winRate: sc.winRate !== null ? sc.winRate * 100 : 0, winRateKnown: sc.winRate !== null, activePositions: eq.open.length, maxPositions: e.maxOpenPositions,
      totalTrades: closed.length, bestTrade: pnls.length ? Math.max(...pnls) : 0, worstTrade: pnls.length ? Math.min(...pnls) : 0, bestSymbol: best?.symbol ?? null, worstSymbol: worst?.symbol ?? null,
      sharpeRatio: sc.sharpeAnnualised ?? 0, sharpeKnown: sc.sharpeAnnualised !== null, equity: eq.equity, cash: a.cashUsd, startingBalance: a.startingBalance, realizedPnl: a.realizedPnl,
      maxDrawdownPct: sc.maxDrawdownPct, ...runState(a), pauseReason: a.pauseReason, ...trialInfo(u),
    });
  } catch (e) { return errorResponse(e); }
}
