export interface ExitParams {
  stopLossPct: number; takeProfitPct: number; breakEvenTriggerPct: number; enableTrailingStop: boolean; trailingStopPct: number; holdTimeMinutes: number;
  /** Stale-position exit: after this many minutes, close if P&L is still inside ±staleBandPct. 0 disables. */
  stalePositionMinutes?: number; staleBandPct?: number;
  /** Peak gain (%) that arms the trailing stop. Unset/0 = breakEvenTriggerPct (old behaviour). */
  trailingArmPct?: number;
  /** Hard ceiling on a dynamic/plan stop (looser stops are capped; tighter stops stay tighter). */
  hardStopCeilingPct?: number;
}
export interface PositionLike { entryPrice: number; highestPrice: number; openedAt: Date }
export type ExitReason = 'stop_loss' | 'take_profit' | 'break_even' | 'trailing_stop' | 'stale_exit' | 'time_exit';

/** House hard stop: a dynamic or plan stop may be tighter, never looser than this (percent). */
export const HARD_STOP_CEILING_PCT = 20;

/** Effective stop = min(plan/dynamic stop, hard ceiling). Invalid values fall back to the ceiling. */
export function effectiveStopLossPct(stopLossPct: number, hardCeilingPct = HARD_STOP_CEILING_PCT): number {
  const stop = Number(stopLossPct);
  const cap = Number(hardCeilingPct);
  if (stop > 0 && cap > 0) return Math.min(stop, cap);
  if (stop > 0) return stop;
  return cap > 0 ? cap : HARD_STOP_CEILING_PCT;
}

/**
 * Stop/TP (and other exitDecision reasons) always beat volume/fade. Used so a breached stop
 * cannot be skipped by a later low-volume sell.
 */
export function preferStopOverSecondary<S extends string>(
  primary: ExitReason | null,
  secondary: S | null,
): ExitReason | S | null {
  return primary ?? secondary;
}

/** Decide whether an open position should be FULLY closed at `price` (pure; unit-tested). */
export function exitDecision(pos: PositionLike, price: number, p: ExitParams, now = new Date()): ExitReason | null {
  const peak = Math.max(pos.highestPrice, price);
  const pnlPct = (price / pos.entryPrice - 1) * 100;
  const peakPct = (peak / pos.entryPrice - 1) * 100;
  const ageMin = (now.getTime() - pos.openedAt.getTime()) / 60_000;
  const stopPct = effectiveStopLossPct(p.stopLossPct, p.hardStopCeilingPct ?? HARD_STOP_CEILING_PCT);
  if (pnlPct <= -stopPct) return 'stop_loss';
  if (pnlPct >= p.takeProfitPct) return 'take_profit';
  if (p.enableTrailingStop && peakPct >= (p.trailingArmPct && p.trailingArmPct > 0 ? p.trailingArmPct : p.breakEvenTriggerPct) && price <= peak * (1 - p.trailingStopPct / 100) && price > pos.entryPrice) return 'trailing_stop';
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
