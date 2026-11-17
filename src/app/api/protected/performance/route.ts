import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { errorResponse } from '@/lib/auth';
import { appContext } from '@/lib/app-api';
import { accountEquity } from '@/lib/engine';
import { computeScorecard } from '@/lib/scorecard';

export const dynamic = 'force-dynamic';

function parseSignals(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export async function GET() {
  try {
    const { a, c } = await appContext();
    const paperTrades = { accountId: a.id, status: 'closed', simulated: true };
    const [equity, allClosed, newestClosed, daily] = await Promise.all([
      accountEquity(a),
      prisma.position.aggregate({ where: paperTrades, _sum: { pnlUsd: true }, _count: { _all: true } }),
      prisma.position.findMany({
        where: paperTrades,
        orderBy: [{ closedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        take: 5000,
        select: { id: true, symbol: true, mint: true, network: true, sizeUsd: true, entryPrice: true, exitPrice: true, feesUsd: true, pnlUsd: true, pnlPct: true, openedAt: true, closedAt: true, exitReason: true, simulated: true, signals: true },
      }),
      prisma.position.aggregate({
        where: { ...paperTrades, closedAt: { gte: new Date(Date.now() - 86_400_000) } },
        _sum: { pnlUsd: true, feesUsd: true }, _count: { _all: true },
      }),
    ]);

    const closed = [...newestClosed].reverse();
    const closedCount = allClosed._count._all;
    const truncated = closedCount > closed.length;
    const analyzedPnl = closed.reduce((sum, trade) => sum + (trade.pnlUsd ?? 0), 0);
    const openingEquity = a.startingBalance + (truncated ? (allClosed._sum.pnlUsd ?? 0) - analyzedPnl : 0);
    const scorecard = computeScorecard(
      closed.map(t => ({ pnlUsd: t.pnlUsd ?? 0, pnlPct: t.pnlPct ?? 0, closedAt: t.closedAt ?? t.openedAt })),
      openingEquity,
    );
    const strategies = new Map<string, { trades: number; wins: number; pnlUsd: number; feesUsd: number }>();
    for (const trade of closed) {
      const signals = parseSignals(trade.signals);
      const active = Object.entries(signals).filter(([, value]) => typeof value === 'number' ? value > 0 : value === true).map(([key]) => key);
      for (const key of active) {
        const row = strategies.get(key) ?? { trades: 0, wins: 0, pnlUsd: 0, feesUsd: 0 };
        row.trades += 1;
        row.wins += (trade.pnlUsd ?? 0) > 0 ? 1 : 0;
        row.pnlUsd += trade.pnlUsd ?? 0;
        row.feesUsd += trade.feesUsd ?? 0;
        strategies.set(key, row);
      }
    }

    const curve = [];
    let running = openingEquity;
    for (const trade of closed) {
      running += trade.pnlUsd ?? 0;
      curve.push({ at: (trade.closedAt ?? trade.openedAt).toISOString(), equity: Number(running.toFixed(2)), pnlUsd: trade.pnlUsd ?? 0 });
    }
    const open = equity.open.map(p => ({
      id: p.id, symbol: p.symbol, network: p.network, mint: p.mint, openedAt: p.openedAt.toISOString(),
      entryPrice: p.entryPrice, markPrice: p.lastPrice, sizeUsd: p.sizeUsd, feesUsd: p.feesUsd,
      unrealizedPnlUsd: p.tokenAmount * p.lastPrice - p.sizeUsd - p.feesUsd,
      unrealizedPnlPct: p.entryPrice > 0 ? (p.lastPrice / p.entryPrice - 1) * 100 : 0,
    }));
    const recent = newestClosed.slice(0, 50).map(t => ({
      id: t.id, symbol: t.symbol, network: t.network, mint: t.mint, sizeUsd: t.sizeUsd,
      entryPrice: t.entryPrice, exitPrice: t.exitPrice, feesUsd: t.feesUsd, pnlUsd: t.pnlUsd ?? 0,
      pnlPct: t.pnlPct ?? 0, openedAt: t.openedAt.toISOString(), closedAt: t.closedAt?.toISOString() ?? null,
      exitReason: t.exitReason, simulated: t.simulated,
    }));

    const stride = Math.max(1, Math.ceil((curve.length - 1) / 119));
    const equityCurve = curve.filter((_, index) => index % stride === 0 || index === curve.length - 1);

    return NextResponse.json({
      mode: c.mode, generatedAt: new Date().toISOString(),
      account: { startingBalance: a.startingBalance, cashUsd: a.cashUsd, equityUsd: equity.equity, realizedPnlUsd: a.realizedPnl,
        unrealizedPnlUsd: open.reduce((sum, p) => sum + p.unrealizedPnlUsd, 0) },
      coverage: { closedTradesAvailable: closedCount, analyzedTrades: closed.length, truncated, recentTradesReturned: recent.length },
      scorecard, last24h: { trades: daily._count._all, pnlUsd: daily._sum.pnlUsd ?? 0, feesUsd: daily._sum.feesUsd ?? 0 },
      strategyAttribution: [...strategies.entries()].map(([signal, v]) => ({ signal, ...v, winRate: v.trades ? v.wins / v.trades : 0 })).sort((x, y) => y.pnlUsd - x.pnlUsd),
      equityCurve,
      openPositions: open, recentTrades: recent,
    });
  } catch (error) { return errorResponse(error); }
}
