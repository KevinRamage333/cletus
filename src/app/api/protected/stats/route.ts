import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { errorResponse } from '@/lib/auth';
import { appContext, runState } from '@/lib/app-api';
import { accountEquity } from '@/lib/engine';
import { computeScorecard } from '@/lib/scorecard';
import { trialInfo } from '@/lib/trial';
import { listApprovals } from '@/lib/approval-store';
import { tradeFeeView, solscanTxUrl, solscanAccountUrl } from '@/lib/approvals';
import { DEFAULT_OPERATOR_FEE_BPS } from '@/lib/jupiter';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { u, a, e } = await appContext();
    const [eq, closed, last24, approvals] = await Promise.all([
      accountEquity(a),
      prisma.position.findMany({ where: { accountId: a.id, status: 'closed' }, orderBy: { closedAt: 'desc' }, take: 50 }),
      prisma.position.aggregate({ where: { accountId: a.id, status: 'closed', closedAt: { gte: new Date(Date.now() - 86_400_000) } }, _sum: { pnlUsd: true } }),
      listApprovals(a.id),
    ]);
    const sc = computeScorecard(closed.map((t) => ({ pnlUsd: t.pnlUsd ?? 0, pnlPct: t.pnlPct ?? 0, closedAt: t.closedAt ?? new Date() })), a.startingBalance);
    const unrealized = eq.open.reduce((s, p) => s + p.tokenAmount * p.lastPrice - p.sizeUsd - p.feesUsd, 0);
    const realized24 = last24._sum.pnlUsd ?? 0;
    const pnls = closed.map((t) => t.pnlUsd ?? 0);
    const best = closed.length ? closed.reduce((m, t) => ((t.pnlUsd ?? 0) > (m.pnlUsd ?? 0) ? t : m)) : null;
    const worst = closed.length ? closed.reduce((m, t) => ((t.pnlUsd ?? 0) < (m.pnlUsd ?? 0) ? t : m)) : null;
    const openView = eq.open.map((p) => {
      const fees = tradeFeeView({ sizeUsd: p.sizeUsd, feesUsd: p.feesUsd, tokenAmount: p.tokenAmount });
      const pnlUsd = p.tokenAmount * p.lastPrice - p.sizeUsd - p.feesUsd;
      return { id: p.id, symbol: p.symbol, mint: p.mint, sizeUsd: p.sizeUsd, entryPrice: p.entryPrice, lastPrice: p.lastPrice, tokenAmount: p.tokenAmount, feesUsd: p.feesUsd, operatorFeeUsd: fees.entryOperatorFeeUsd, operatorFeeBps: fees.operatorFeeBps, pnlUsd, pnlPct: (p.lastPrice / p.entryPrice - 1) * 100, openedAt: p.openedAt, simulated: p.simulated, entryTx: p.entryTx, solscanEntry: solscanTxUrl(p.entryTx), solscanMint: solscanAccountUrl(p.mint) };
    });
    const closedView = closed.map((p) => {
      const fees = tradeFeeView({ sizeUsd: p.sizeUsd, feesUsd: p.feesUsd, tokenAmount: p.tokenAmount, exitPrice: p.exitPrice });
      return { id: p.id, symbol: p.symbol, mint: p.mint, sizeUsd: p.sizeUsd, entryPrice: p.entryPrice, exitPrice: p.exitPrice, pnlUsd: p.pnlUsd, pnlPct: p.pnlPct, feesUsd: p.feesUsd, operatorFeeUsd: fees.operatorFeeUsd, operatorFeeBps: fees.operatorFeeBps, exitReason: p.exitReason, openedAt: p.openedAt, closedAt: p.closedAt, simulated: p.simulated, entryTx: p.entryTx, exitTx: p.exitTx, solscanEntry: solscanTxUrl(p.entryTx), solscanExit: solscanTxUrl(p.exitTx), solscanMint: solscanAccountUrl(p.mint) };
    });
    return NextResponse.json({
      pnl24h: realized24 + unrealized, pnl24hRealized: realized24, unrealized, pnl24hPercent: a.startingBalance ? ((realized24 + unrealized) / a.startingBalance) * 100 : 0,
      winRate: sc.winRate !== null ? sc.winRate * 100 : 0, winRateKnown: sc.winRate !== null, activePositions: eq.open.length, maxPositions: e.maxOpenPositions,
      totalTrades: closed.length, bestTrade: pnls.length ? Math.max(...pnls) : 0, worstTrade: pnls.length ? Math.min(...pnls) : 0, bestSymbol: best?.symbol ?? null, worstSymbol: worst?.symbol ?? null,
      sharpeRatio: sc.sharpeAnnualised ?? 0, sharpeKnown: sc.sharpeAnnualised !== null, equity: eq.equity, cash: a.cashUsd, startingBalance: a.startingBalance, realizedPnl: a.realizedPnl, totalPnl: a.realizedPnl + unrealized,
      maxDrawdownPct: sc.maxDrawdownPct, ...runState(a), pauseReason: a.pauseReason, ...trialInfo(u),
      identity: u.email, wallet: { address: u.walletPublicKey, source: u.walletSource ?? (u.walletPublicKey ? 'connected' : 'paper'), connected: Boolean(u.walletPublicKey) },
      operatorFeeBps: DEFAULT_OPERATOR_FEE_BPS,
      open: openView, closed: closedView, approvals,
    });
  } catch (e) { return errorResponse(e); }
}
