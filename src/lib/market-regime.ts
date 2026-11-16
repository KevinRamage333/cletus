/**
 * Broad-market regime filter for the Solana scanner.
 * Uses robust medians so one extreme token cannot dominate the market read.
 */
export type MarketRegime = 'risk_on' | 'neutral' | 'risk_off' | 'high_volatility' | 'unknown';
export interface MarketObservation { h1?: number; h24?: number }
export interface MarketRegimeAssessment {
  regime: MarketRegime; sampleSize: number; medianH1Pct: number | null; medianH24Pct: number | null;
  medianAbsH1Pct: number | null; breadthUp: number | null; confidence: 'low' | 'moderate' | 'high';
  assessedAt: number; reasons: string[];
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b); const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function assessMarketRegime(observations: MarketObservation[], now = Date.now()): MarketRegimeAssessment {
  const rows = observations.filter((x) => finite(x.h1));
  const h1 = rows.map((x) => x.h1!);
  const h24 = rows.map((x) => x.h24).filter(finite);
  const medianH1Pct = median(h1), medianH24Pct = median(h24);
  const medianAbsH1Pct = median(h1.map(Math.abs));
  const breadthUp = h1.length ? h1.filter((x) => x > 0).length / h1.length : null;
  const n = h1.length;
  const confidence = n >= 30 ? 'high' : n >= 15 ? 'moderate' : 'low';
  const reasons: string[] = [];
  let regime: MarketRegime = 'unknown';

  if (n < 10) reasons.push('fewer than 10 valid one-hour observations; market read is uncertain');
  else if ((medianAbsH1Pct ?? 0) >= 18) {
    regime = 'high_volatility';
    reasons.push('typical one-hour absolute move is at least 18%; avoid fresh entries in disorderly conditions');
  } else if ((medianH1Pct ?? 0) <= -2.5 || (breadthUp ?? 1) <= 0.35 || (medianH24Pct !== null && medianH24Pct <= -8)) {
    regime = 'risk_off';
    if ((medianH1Pct ?? 0) <= -2.5) reasons.push('median one-hour move is at or below -2.5%');
    if ((breadthUp ?? 1) <= 0.35) reasons.push('35% or fewer tracked tokens are up over one hour');
    if (medianH24Pct !== null && medianH24Pct <= -8) reasons.push('median 24-hour move is at or below -8%');
  } else if ((medianH1Pct ?? 0) >= 2 && (breadthUp ?? 0) >= 0.6 && (medianAbsH1Pct ?? 100) < 15) {
    regime = 'risk_on';
    reasons.push('broad positive one-hour trend with controlled typical volatility');
  } else {
    regime = 'neutral'; reasons.push('no sufficiently strong broad-market direction');
  }
  const coverage = clamp01(n / 30);
  const directional = regime === 'risk_on' || regime === 'risk_off' ? 0.7 : regime === 'high_volatility' ? 0.8 : 0.4;
  const confidenceScore = regime === 'unknown' ? 0 : Math.round(100 * coverage * directional);
  if (n >= 10 && n < 15) reasons.push('limited sample; classification confidence is low');
  reasons.push(`classification strength ${confidenceScore}/100 (not a profit probability)`);
  return { regime, sampleSize: n, medianH1Pct, medianH24Pct, medianAbsH1Pct, breadthUp, confidence, assessedAt: now, reasons };
}

export function marketRegimeBlocksEntries(regime: MarketRegime): boolean {
  return regime === 'risk_off' || regime === 'high_volatility';
}
