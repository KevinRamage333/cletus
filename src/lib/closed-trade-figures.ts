import { computeScorecard } from './scorecard';

export type ClosedRow = { symbol: string; sizeUsd: number; pnlUsd: number | null; pnlPct: number | null; closedAt: Date | null; openedAt: Date };

/**
 * Scorecard and best/worst from closed trades. A trade without a finite recorded P&L is unknown,
 * not a $0 trade, so it is left out of the win rate, Sharpe, drawdown and best/worst.
 */
export function closedTradeFigures(closed: ClosedRow[], startingBalance: number) {
  const scored = closed.filter((t): t is ClosedRow & { pnlUsd: number } => t.pnlUsd != null && Number.isFinite(t.pnlUsd));
  const sc = computeScorecard(
    scored.map((t) => ({ pnlUsd: t.pnlUsd, pnlPct: t.pnlPct ?? (t.sizeUsd ? (t.pnlUsd / t.sizeUsd) * 100 : 0), closedAt: t.closedAt ?? t.openedAt })),
    startingBalance,
  );
  const best = scored.length ? scored.reduce((m, t) => (t.pnlUsd > m.pnlUsd ? t : m)) : null;
  const worst = scored.length ? scored.reduce((m, t) => (t.pnlUsd < m.pnlUsd ? t : m)) : null;
  return {
    sc,
    scoredCount: scored.length,
    bestTrade: best ? best.pnlUsd : null,
    worstTrade: worst ? worst.pnlUsd : null,
    bestSymbol: best?.symbol ?? null,
    worstSymbol: worst?.symbol ?? null,
  };
}

/** 24h P&L as a percent of starting balance; unknown (null) when there is no starting balance. */
export function pnlPercentOfStart(pnlUsd: number, startingBalance: number): number | null {
  return startingBalance > 0 && Number.isFinite(pnlUsd) ? (pnlUsd / startingBalance) * 100 : null;
}
