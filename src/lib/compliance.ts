/**
 * Market-conduct guardrail ("SEC compliance gate"). These are self-imposed
 * limits modelled on anti-manipulation principles (no wash trades, no outsized
 * share of volume/liquidity, no artificial activity). They are NOT legal advice
 * and do not by themselves make any activity compliant with any law.
 */

export interface ComplianceParams {
  maxVolumeShare: number; // fraction of token 24h volume per trade
  maxLiquidityShare: number; // fraction of pool liquidity per trade
  washTradeWindowMin: number;
  maxTradesPer5Min: number;
}
export interface TradeRecord { mint: string; openedAt: Date; closedAt?: Date | null }
export interface ComplianceInput {
  mint: string;
  sizeUsd: number;
  volume24hUsd: number;
  liquidityUsd: number | null;
  history: TradeRecord[]; // this account's positions (open + recently closed)
  now?: Date;
}
export interface ComplianceResult { allowed: boolean; maxAllowedUsd: number; adjustedSizeUsd: number; reasons: string[] }

export function complianceGate(i: ComplianceInput, p: ComplianceParams, minTradeUsd = 10): ComplianceResult {
  const now = (i.now ?? new Date()).getTime();
  const reasons: string[] = [];
  let blocked = false;

  // Velocity: count trade events (entries and exits) across all tokens in last 5 minutes.
  const fiveMin = now - 5 * 60_000;
  const events = i.history.reduce((n, t) => n + (t.openedAt.getTime() >= fiveMin ? 1 : 0) + (t.closedAt && t.closedAt.getTime() >= fiveMin ? 1 : 0), 0);
  if (events >= p.maxTradesPer5Min) { blocked = true; reasons.push(`velocity: ${events} trades in last 5 min (max ${p.maxTradesPer5Min})`); }

  // Wash-trade window: no re-entry into a token bought and sold within the window, and no stacking an open position.
  const windowStart = now - p.washTradeWindowMin * 60_000;
  for (const t of i.history) {
    if (t.mint !== i.mint) continue;
    if (!t.closedAt) { blocked = true; reasons.push('already holding an open position in this token'); break; }
    if (t.closedAt.getTime() >= windowStart) { blocked = true; reasons.push(`wash-trade window: round trip in this token within ${p.washTradeWindowMin} min`); break; }
  }

  // Position concentration (spec: a trade exceeding either limit is BLOCKED). The sizing step
  // pre-caps size to these limits (liquidity-aware sizing), so this is a hard backstop.
  const volCap = i.volume24hUsd > 0 ? i.volume24hUsd * p.maxVolumeShare : 0;
  let liqCap = 0;
  if (i.liquidityUsd === null || !(i.liquidityUsd > 0)) { blocked = true; reasons.push('liquidity unknown'); }
  else liqCap = i.liquidityUsd * p.maxLiquidityShare;
  const maxAllowedUsd = Math.max(0, Math.min(volCap, liqCap));
  if (i.sizeUsd > maxAllowedUsd + 1e-6) {
    blocked = true;
    reasons.push(`concentration: $${i.sizeUsd.toFixed(2)} exceeds ${p.maxVolumeShare * 100}% of 24h volume / ${p.maxLiquidityShare * 100}% of liquidity (max $${maxAllowedUsd.toFixed(2)})`);
  }
  if (!blocked && i.sizeUsd < minTradeUsd) { blocked = true; reasons.push(`size < $${minTradeUsd}`); }
  const adjusted = i.sizeUsd;
  return { allowed: !blocked, maxAllowedUsd, adjustedSizeUsd: blocked ? 0 : Math.floor(adjusted * 100) / 100, reasons };
}

/** Liquidity-aware sizing: the largest size the concentration limits allow (used before the gate). */
export function concentrationCap(volume24hUsd: number, liquidityUsd: number | null, p: Pick<ComplianceParams, 'maxVolumeShare' | 'maxLiquidityShare'>): number {
  if (!(liquidityUsd && liquidityUsd > 0) || !(volume24hUsd > 0)) return 0;
  return Math.floor(Math.min(volume24hUsd * p.maxVolumeShare, liquidityUsd * p.maxLiquidityShare) * 100) / 100;
}
