export interface PaperPlanInput {
  entry: number;
  sizeUsd: number;
  stopPct: number;
  targetPct: number;
  costsUsd: number;
}

export function calculatePaperPlan({ entry, sizeUsd, stopPct, targetPct, costsUsd }: PaperPlanInput) {
  if (![entry, sizeUsd, stopPct, targetPct, costsUsd].every(Number.isFinite)
    || entry <= 0 || sizeUsd <= 0 || stopPct <= 0 || stopPct >= 100 || targetPct <= 0 || costsUsd < 0) {
    return null;
  }

  const tokens = sizeUsd / entry;
  const stopPrice = entry * (1 - stopPct / 100);
  const targetPrice = entry * (1 + targetPct / 100);
  const lossAtStop = sizeUsd * (stopPct / 100) + costsUsd;
  const pnlAtTarget = sizeUsd * (targetPct / 100) - costsUsd;
  const ratio = pnlAtTarget > 0 ? pnlAtTarget / lossAtStop : null;
  if (stopPrice <= 0 || lossAtStop <= 0 || ![tokens, stopPrice, targetPrice, lossAtStop, pnlAtTarget, ratio ?? 0].every(Number.isFinite)) {
    return null;
  }

  return { tokens, stopPrice, targetPrice, lossAtStop, pnlAtTarget, ratio };
}
