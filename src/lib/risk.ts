/**
 * Hard risk limits (pure; unit-tested). These run before sizing and can only make
 * the bot trade LESS: block entries, cap size, or pause the account.
 */
export interface RiskParams {
  dailyLossLimitUsd: number; // negative USD, e.g. -300; 0 disables
  maxDailyLossPct: number; // % of start-of-day equity; 0 disables
  maxPositionPctOfEquity: number; // % of wallet/equity per position; 0 disables
  maxConsecutiveLosses: number; // auto-pause after N losses in a row; 0 disables
}
export interface RiskState { dayPnlUsd: number; equityUsd: number; consecutiveLosses: number }

export function hardRiskBlock(s: RiskState, p: RiskParams): string | null {
  if (p.dailyLossLimitUsd < 0 && s.dayPnlUsd <= p.dailyLossLimitUsd) return `max daily loss hit ($${s.dayPnlUsd.toFixed(2)} <= $${p.dailyLossLimitUsd})`;
  if (p.maxDailyLossPct > 0) {
    const startEquity = s.equityUsd - s.dayPnlUsd;
    if (startEquity > 0 && s.dayPnlUsd < 0 && (-s.dayPnlUsd / startEquity) * 100 >= p.maxDailyLossPct) return `max daily loss ${p.maxDailyLossPct}% of equity hit`;
  }
  if (p.maxConsecutiveLosses > 0 && s.consecutiveLosses >= p.maxConsecutiveLosses) return `${s.consecutiveLosses} losses in a row (max ${p.maxConsecutiveLosses})`;
  return null;
}

/** Cap a position at maxPositionPctOfEquity of the wallet. */
export function capByEquityPct(sizeUsd: number, equityUsd: number, pct: number): { sizeUsd: number; capped: boolean } {
  if (!(pct > 0)) return { sizeUsd, capped: false };
  const cap = Math.floor(((equityUsd * pct) / 100) * 100) / 100;
  return sizeUsd > cap ? { sizeUsd: Math.max(0, cap), capped: true } : { sizeUsd, capped: false };
}

/** Should the account auto-pause after this trade result? */
export function lossStreakPause(consecutiveLossesAfter: number, max: number): boolean {
  return max > 0 && consecutiveLossesAfter >= max;
}


/** Never size a trade above equity minus the reserved SOL (for the exit-sell gas). */
export function capByFeeReserve(sizeUsd: number, equityUsd: number, reserveUsd: number): { sizeUsd: number; capped: boolean } {
  const cap = Math.floor(Math.max(0, equityUsd - Math.max(0, reserveUsd)) * 100) / 100;
  return sizeUsd > cap ? { sizeUsd: cap, capped: true } : { sizeUsd, capped: false };
}
