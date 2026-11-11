import type { SizingTier } from './config';

export function tierFor(cumulativePnl: number, tiers: SizingTier[]): SizingTier {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  let t = sorted[0];
  for (const x of sorted) if (cumulativePnl >= x.threshold) t = x;
  return t;
}

export interface SizingInput {
  equityUsd: number;
  cashUsd: number;
  openExposureUsd: number;
  cumulativePnl: number;
  recoveryMode: boolean;
}
export interface SizingParams {
  maxPositionSizeUsd: number;
  riskPerTradePct: number;
  stopLossPct: number;
  maxTotalExposurePct: number;
  equityProtectionLevel: number;
  recoveryMultiplier: number;
  minTradeUsd: number;
  tiers: SizingTier[];
}
export interface SizingResult { sizeUsd: number; tier: number; multiplier: number; notes: string[] }

/**
 * Progressive position sizing:
 *   base = min(MAX_POSITION_SIZE_USD, equity * RISK_PER_TRADE% / STOP_LOSS%)
 *   size = base * tierMultiplier(cumulative PnL)   ($60k+ => 3.0x)
 * then reduced by recovery mode / equity protection and capped by total exposure and cash.
 */
export function computePositionSize(i: SizingInput, p: SizingParams): SizingResult {
  const notes: string[] = [];
  const riskBased = p.stopLossPct > 0 ? (i.equityUsd * (p.riskPerTradePct / 100)) / (p.stopLossPct / 100) : p.maxPositionSizeUsd;
  const base = Math.min(p.maxPositionSizeUsd, riskBased);
  const t = tierFor(i.cumulativePnl, p.tiers);
  let size = base * t.multiplier;
  notes.push(`base $${base.toFixed(2)} x tier ${t.tier} (${t.multiplier}x)`);
  if (i.recoveryMode) { size *= p.recoveryMultiplier; notes.push(`recovery x${p.recoveryMultiplier}`); }
  if (p.equityProtectionLevel > 0 && i.equityUsd < p.equityProtectionLevel) { size *= 0.5; notes.push('equity protection x0.5'); }
  const exposureRoom = (i.equityUsd * p.maxTotalExposurePct) / 100 - i.openExposureUsd;
  if (size > exposureRoom) { size = Math.max(0, exposureRoom); notes.push('capped by max total exposure'); }
  if (size > i.cashUsd) { size = Math.max(0, i.cashUsd); notes.push('capped by cash'); }
  if (size < p.minTradeUsd) { notes.push(`below min trade $${p.minTradeUsd}`); size = 0; }
  return { sizeUsd: Math.floor(size * 100) / 100, tier: t.tier, multiplier: t.multiplier, notes };
}
