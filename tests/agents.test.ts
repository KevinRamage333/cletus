import { describe, expect, it } from "vitest";
import {
  AGENT_DEFINITIONS,
  agentCan,
  isForbiddenAgentCapability,
} from "../src/lib/agents/registry";
import { analyzeAllocation } from "../src/lib/agents/signal-allocator";
import { auditSubscriptions, auditTokenomics } from "../src/lib/agents/charlotte";
import { triageForDefender } from "../src/lib/agents/defender";

describe("Cletus agent council", () => {
  it("registers the three bounded specialist agents", () => {
    expect(AGENT_DEFINITIONS.map((agent) => agent.id)).toEqual([
      "signal-allocator", "charlotte", "defender",
    ]);
  });

  it("does not grant any agent execution, custody, payment, or secret permissions", () => {
    for (const agent of AGENT_DEFINITIONS) {
      expect(agentCan(agent.id, "trade:execute")).toBe(false);
      expect(agentCan(agent.id, "wallet:sign")).toBe(false);
      expect(agentCan(agent.id, "funds:transfer")).toBe(false);
      expect(agentCan(agent.id, "secrets:read")).toBe(false);
    }
    expect(isForbiddenAgentCapability("token:mint")).toBe(true);
  });

  it("sizes a recommendation under cash, fee reserve, exposure, and stop-risk caps", () => {
    const result = analyzeAllocation({
      mode: "simulation", signalScore: 0.9, minimumSignalScore: 0.7,
      confidence: 0.85, minimumConfidence: 0.7, riskScore: 20, maximumRiskScore: 40,
      liquidityUsd: 100_000, minimumLiquidityUsd: 25_000,
      expectedSlippageBps: 80, maximumSlippageBps: 150,
      equityUsd: 1_000, cashUsd: 700, openExposureUsd: 200, feeReserveUsd: 25,
      maxPositionUsd: 500, maxTotalExposurePct: 60, riskPerTradePct: 1,
      stopLossPct: 10, minimumOrderUsd: 10,
    });
    expect(result.recommendation).toBe("paper_candidate");
    expect(result.suggestedSizeUsd).toBe(100);
    expect(result.estimatedLossAtStopUsd).toBe(10);
    expect(result.execution).toBe("none");
  });

  it("skips when risk gates fail and fails closed on invalid inputs", () => {
    const base = {
      mode: "simulation" as const, signalScore: 0.9, minimumSignalScore: 0.7,
      confidence: 0.9, minimumConfidence: 0.7, riskScore: 90, maximumRiskScore: 40,
      liquidityUsd: 100_000, minimumLiquidityUsd: 25_000,
      expectedSlippageBps: 50, maximumSlippageBps: 150,
      equityUsd: 1_000, cashUsd: 700, openExposureUsd: 200, feeReserveUsd: 25,
      maxPositionUsd: 500, maxTotalExposurePct: 60, riskPerTradePct: 1,
      stopLossPct: 10, minimumOrderUsd: 10,
    };
    expect(analyzeAllocation(base).recommendation).toBe("skip");
    expect(analyzeAllocation({ ...base, stopLossPct: 0 }).recommendation).toBe("skip");
  });

  it("never treats a live allocation as an executable trade", () => {
    const result = analyzeAllocation({
      mode: "live", signalScore: 0.9, minimumSignalScore: 0.7,
      confidence: 0.9, minimumConfidence: 0.7, riskScore: 10, maximumRiskScore: 40,
      liquidityUsd: 100_000, minimumLiquidityUsd: 25_000,
      expectedSlippageBps: 50, maximumSlippageBps: 150,
      equityUsd: 1_000, cashUsd: 700, openExposureUsd: 200, feeReserveUsd: 25,
      maxPositionUsd: 500, maxTotalExposurePct: 60, riskPerTradePct: 1,
      stopLossPct: 10, minimumOrderUsd: 10,
    });
    expect(result.recommendation).toBe("owner_review_required");
    expect(result.execution).toBe("none");
  });

  it("Charlotte estimates recurring spend and flags duplicate vendors", () => {
    const result = auditSubscriptions([
      { id: "a", provider: "Example Streaming", amount: 12, currency: "USD", interval: "monthly", active: true },
      { id: "b", provider: "example-streaming", amount: 120, currency: "USD", interval: "yearly", active: true },
    ]);
    expect(result.estimatedMonthlySpend).toBe(22);
    expect(result.duplicateProviderGroups).toEqual([["a", "b"]]);
    expect(result.estimatedMonthlySavingsIfDuplicatesReviewed).toBe(10);
  });

  it("Charlotte flags an unfunded advertised staking reward liability", () => {
    const result = auditTokenomics({
      totalSupply: 1_000_000, circulatingSupply: 500_000, treasuryTokens: 300_000,
      annualEmissions: 100_000, annualStakingRewardBudgetUsd: 1_000,
      stakingDepositsUsd: 100_000, advertisedAprPct: 20, referenceTokenPriceUsd: 1,
      maxTreasuryConcentrationPct: 20, maxAnnualEmissionPct: 10,
    });
    expect(result.status).toBe("risk_flags");
    expect(result.flags.some((flag) => flag.includes("reward budget"))).toBe(true);
  });

  it("Defender creates a review ticket without authorizing self-remediation", () => {
    const result = triageForDefender({
      kind: "credential_exposure", observedAt: "2026-11-16T00:00:00.000Z",
      evidenceRef: "incident://redacted", confidence: 0.99, authorizedScope: true,
    });
    expect(result.decision.triggerEmergencyStop).toBe(true);
    expect(result.decision.allowAutonomousRepair).toBe(false);
    expect(result.ticket.ownerApprovalRequired).toBe(true);
  });
});
