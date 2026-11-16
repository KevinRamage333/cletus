/**
 * Deterministic, recommendation-only allocation analysis.
 *
 * This module never creates orders, calls a wallet, or changes engine settings.
 * The existing engine risk/compliance gates remain authoritative.
 */
export interface AllocationAnalysisInput {
  mode: "simulation" | "live";
  signalScore: number;
  minimumSignalScore: number;
  confidence: number;
  minimumConfidence: number;
  riskScore: number;
  maximumRiskScore: number;
  liquidityUsd: number;
  minimumLiquidityUsd: number;
  expectedSlippageBps: number;
  maximumSlippageBps: number;
  equityUsd: number;
  cashUsd: number;
  openExposureUsd: number;
  feeReserveUsd: number;
  maxPositionUsd: number;
  maxTotalExposurePct: number;
  riskPerTradePct: number;
  stopLossPct: number;
  minimumOrderUsd: number;
}

export interface AllocationAnalysis {
  recommendation: "skip" | "watch" | "paper_candidate" | "owner_review_required";
  suggestedSizeUsd: number;
  estimatedLossAtStopUsd: number;
  execution: "none";
  reasons: string[];
  constraints: {
    cashAfterReserveUsd: number;
    remainingExposureUsd: number;
    riskBudgetUsd: number;
  };
}

const finiteNonNegative = (value: number) => Number.isFinite(value) && value >= 0;
const roundCents = (value: number) => Math.floor(Math.max(0, value) * 100) / 100;

export function analyzeAllocation(input: AllocationAnalysisInput): AllocationAnalysis {
  const reasons: string[] = [];
  const numericValues = Object.entries(input).filter(([, value]) => typeof value === "number");
  const invalid = numericValues
    .filter(([, value]) => !finiteNonNegative(value as number))
    .map(([key]) => key);

  if (invalid.length || input.stopLossPct <= 0 || input.maxTotalExposurePct > 100 ||
      input.riskPerTradePct > 100 || input.minimumSignalScore > 1 ||
      input.signalScore > 1 || input.confidence > 1 ||
      input.minimumConfidence > 1) {
    return {
      recommendation: "skip",
      suggestedSizeUsd: 0,
      estimatedLossAtStopUsd: 0,
      execution: "none",
      reasons: ["Invalid or out-of-range allocation inputs; fail closed.", ...invalid],
      constraints: { cashAfterReserveUsd: 0, remainingExposureUsd: 0, riskBudgetUsd: 0 },
    };
  }

  if (input.signalScore < input.minimumSignalScore) reasons.push("Signal score is below the configured threshold.");
  if (input.confidence < input.minimumConfidence) reasons.push("Evidence confidence is below the configured threshold.");
  if (input.riskScore > input.maximumRiskScore) reasons.push("Token or market risk exceeds the configured ceiling.");
  if (input.liquidityUsd < input.minimumLiquidityUsd) reasons.push("Available liquidity is below the configured minimum.");
  if (input.expectedSlippageBps > input.maximumSlippageBps) reasons.push("Expected slippage exceeds the configured maximum.");

  const cashAfterReserveUsd = Math.max(0, input.cashUsd - input.feeReserveUsd);
  const remainingExposureUsd = Math.max(
    0,
    (input.equityUsd * input.maxTotalExposurePct) / 100 - input.openExposureUsd,
  );
  const riskBudgetUsd = (input.equityUsd * input.riskPerTradePct) / 100;
  const riskSizedPositionUsd = riskBudgetUsd / (input.stopLossPct / 100);
  const suggestedSizeUsd = roundCents(Math.min(
    input.maxPositionUsd,
    cashAfterReserveUsd,
    remainingExposureUsd,
    riskSizedPositionUsd,
  ));
  const estimatedLossAtStopUsd = roundCents(suggestedSizeUsd * (input.stopLossPct / 100));

  if (suggestedSizeUsd < input.minimumOrderUsd) reasons.push("Risk-bounded allocation is below the minimum order size.");

  if (reasons.length || suggestedSizeUsd <= 0) {
    return {
      recommendation: "skip",
      suggestedSizeUsd: 0,
      estimatedLossAtStopUsd: 0,
      execution: "none",
      reasons: reasons.length ? reasons : ["No positive allocation remains after safety caps."],
      constraints: { cashAfterReserveUsd, remainingExposureUsd, riskBudgetUsd },
    };
  }

  return {
    recommendation: input.mode === "simulation" ? "paper_candidate" : "owner_review_required",
    suggestedSizeUsd,
    estimatedLossAtStopUsd,
    execution: "none",
    reasons: [
      "All supplied advisor thresholds passed; this is a proposal, not an order.",
      "Existing engine audit, compliance, portfolio, and hard-risk gates must independently pass.",
      ...(input.mode === "live" ? ["Live execution remains disabled here and requires the established owner-controlled wallet approval flow."] : ["Paper-trade evaluation only; no live funds are involved."]),
    ],
    constraints: { cashAfterReserveUsd, remainingExposureUsd, riskBudgetUsd },
  };
}
