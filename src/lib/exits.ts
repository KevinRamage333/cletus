export interface ExitParams {
  stopLossPct: number; takeProfitPct: number; breakEvenTriggerPct: number; enableTrailingStop: boolean; trailingStopPct: number; holdTimeMinutes: number;
  /** Stale-position exit: after this many minutes, close if P&L is still inside ±staleBandPct. 0 disables. */
  stalePositionMinutes?: number; staleBandPct?: number;
}
export interface PositionLike { entryPrice: number; highestPrice: number; openedAt: Date }
export type ExitReason = 'stop_loss' | 'take_profit' | 'break_even' | 'trailing_stop' | 'stale_exit' | 'time_exit';

/** Decide whether an open position should be FULLY closed at `price` (pure; unit-tested). */
export function exitDecision(pos: PositionLike, price: number, p: ExitParams, now = new Date()): ExitReason | null {
  const peak = Math.max(pos.highestPrice, price);
  const pnlPct = (price / pos.entryPrice - 1) * 100;
  const peakPct = (peak / pos.entryPrice - 1) * 100;
  const ageMin = (now.getTime() - pos.openedAt.getTime()) / 60_000;
  if (pnlPct <= -p.stopLossPct) return 'stop_loss';
  if (pnlPct >= p.takeProfitPct) return 'take_profit';
  if (p.enableTrailingStop && peakPct >= p.breakEvenTriggerPct && price <= peak * (1 - p.trailingStopPct / 100) && price > pos.entryPrice) return 'trailing_stop';
  if (peakPct >= p.breakEvenTriggerPct && price <= pos.entryPrice) return 'break_even';
  if (p.stalePositionMinutes && p.stalePositionMinutes > 0 && ageMin >= p.stalePositionMinutes && Math.abs(pnlPct) < (p.staleBandPct ?? 2)) return 'stale_exit';
  if (ageMin >= p.holdTimeMinutes) return 'time_exit';
  return null;
}

/** One rung of the partial take-profit ladder: at +gainPct, sell sellPct% of the REMAINING position. */
export interface TpRung { gainPct: number; sellPct: number }

/** Parse "10:33,20:33" into rungs, sorted by gain (pure; unit-tested). Invalid entries are dropped. */
export function parseTpLadder(s: string | undefined | null): TpRung[] {
  if (!s) return [];
  return s.split(',').map((x) => x.split(':').map((v) => Number(v.trim())))
    .filter(([g, f]) => Number.isFinite(g) && Number.isFinite(f) && g > 0 && f > 0 && f < 100)
    .map(([gainPct, sellPct]) => ({ gainPct, sellPct }))
    .sort((a, b) => a.gainPct - b.gainPct);
}

/** Next partial take-profit to execute, if any (pure; unit-tested). `taken` = rungs already executed. */
export function partialTakeProfit(pos: { entryPrice: number }, price: number, ladder: TpRung[], taken: number, finalTpPct: number): { rung: number; fraction: number; gainPct: number } | null {
  const pnlPct = (price / pos.entryPrice - 1) * 100;
  if (pnlPct >= finalTpPct) return null; // the full take-profit handles it
  for (let i = taken; i < ladder.length; i++) {
    if (ladder[i].gainPct >= finalTpPct) break;
    if (pnlPct >= ladder[i].gainPct) return { rung: i + 1, fraction: ladder[i].sellPct / 100, gainPct: ladder[i].gainPct };
    break;
  }
  return null;
}
