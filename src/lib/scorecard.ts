/** Performance scorecard from closed trades (pure; unit-tested). */
export interface ClosedTrade { pnlUsd: number; pnlPct: number; closedAt: Date }
export interface Scorecard {
  trades: number; wins: number; losses: number; winRate: number | null;
  avgWinUsd: number | null; avgLossUsd: number | null; payoffRatio: number | null; profitFactor: number | null;
  netPnlUsd: number; maxDrawdownUsd: number; maxDrawdownPct: number; sharpePerTrade: number | null; sharpeAnnualised: number | null;
}

export function computeScorecard(trades: ClosedTrade[], startingBalance: number): Scorecard {
  const t = [...trades].sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  const wins = t.filter((x) => x.pnlUsd > 0), losses = t.filter((x) => x.pnlUsd <= 0);
  const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
  const grossWin = sum(wins.map((x) => x.pnlUsd)), grossLoss = -sum(losses.map((x) => x.pnlUsd));
  const avgWin = wins.length ? grossWin / wins.length : null;
  const avgLoss = losses.length ? -grossLoss / losses.length : null;
  let eq = startingBalance, peak = startingBalance, ddUsd = 0, ddPct = 0;
  for (const x of t) {
    eq += x.pnlUsd; peak = Math.max(peak, eq);
    if (peak - eq > ddUsd) ddUsd = peak - eq;
    if (peak > 0) ddPct = Math.max(ddPct, ((peak - eq) / peak) * 100);
  }
  const r = t.map((x) => x.pnlPct / 100);
  let sharpe: number | null = null, sharpeAnn: number | null = null;
  if (r.length >= 2) {
    const mean = sum(r) / r.length;
    const sd = Math.sqrt(sum(r.map((v) => (v - mean) ** 2)) / (r.length - 1));
    if (sd > 0) {
      sharpe = mean / sd;
      const days = Math.max(1 / 24, (t[t.length - 1].closedAt.getTime() - t[0].closedAt.getTime()) / 86_400_000);
      sharpeAnn = sharpe * Math.sqrt(Math.min((t.length / days) * 365, 365 * 50)); // trades/yr, clamped
    }
  }
  return {
    trades: t.length, wins: wins.length, losses: losses.length, winRate: t.length ? wins.length / t.length : null,
    avgWinUsd: avgWin, avgLossUsd: avgLoss, payoffRatio: avgWin !== null && avgLoss !== null && avgLoss !== 0 ? avgWin / -avgLoss : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null, netPnlUsd: sum(t.map((x) => x.pnlUsd)),
    maxDrawdownUsd: ddUsd, maxDrawdownPct: ddPct, sharpePerTrade: sharpe, sharpeAnnualised: sharpeAnn,
  };
}
