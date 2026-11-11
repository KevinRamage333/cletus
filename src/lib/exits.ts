export interface ExitParams { stopLossPct: number; takeProfitPct: number; breakEvenTriggerPct: number; enableTrailingStop: boolean; trailingStopPct: number; holdTimeMinutes: number }
export interface PositionLike { entryPrice: number; highestPrice: number; openedAt: Date }
export type ExitReason = 'stop_loss' | 'take_profit' | 'break_even' | 'trailing_stop' | 'time_exit';

/** Decide whether an open position should be closed at `price`. */
export function exitDecision(pos: PositionLike, price: number, p: ExitParams, now = new Date()): ExitReason | null {
  const peak = Math.max(pos.highestPrice, price);
  const pnlPct = (price / pos.entryPrice - 1) * 100;
  const peakPct = (peak / pos.entryPrice - 1) * 100;
  if (pnlPct <= -p.stopLossPct) return 'stop_loss';
  if (pnlPct >= p.takeProfitPct) return 'take_profit';
  if (p.enableTrailingStop && peakPct >= p.breakEvenTriggerPct && price <= peak * (1 - p.trailingStopPct / 100) && price > pos.entryPrice) return 'trailing_stop';
  if (peakPct >= p.breakEvenTriggerPct && price <= pos.entryPrice) return 'break_even';
  if (now.getTime() - pos.openedAt.getTime() >= p.holdTimeMinutes * 60_000) return 'time_exit';
  return null;
}
