/**
 * Charlotte's deterministic oversight checks.
 * Reports and recommendations only: no billing, custody, staking, or token actions.
 */
export type BillingInterval = "weekly" | "monthly" | "quarterly" | "yearly";

export interface SubscriptionRecord {
  id: string;
  provider: string;
  amount: number;
  currency: string;
  interval: BillingInterval;
  active: boolean;
  previousAmount?: number | null;
}

export interface SubscriptionAudit {
  estimatedMonthlySpend: number;
  duplicateProviderGroups: string[][];
  priceIncreaseIds: string[];
  incompleteRecordIds: string[];
  estimatedMonthlySavingsIfDuplicatesReviewed: number;
}

const monthlyAmount = (amount: number, interval: BillingInterval): number => {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  switch (interval) {
    case "weekly": return amount * 52 / 12;
    case "monthly": return amount;
    case "quarterly": return amount / 3;
    case "yearly": return amount / 12;
  }
};

const providerKey = (provider: string) => provider.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export function auditSubscriptions(records: SubscriptionRecord[]): SubscriptionAudit {
  const active = records.filter((record) => record.active);
  const groups = new Map<string, SubscriptionRecord[]>();
  const priceIncreaseIds: string[] = [];
  const incompleteRecordIds: string[] = [];

  for (const record of active) {
    const key = providerKey(record.provider);
    if (!key || !Number.isFinite(record.amount) || record.amount < 0) incompleteRecordIds.push(record.id);
    if (key) groups.set(key, [...(groups.get(key) ?? []), record]);
    if (record.previousAmount != null && Number.isFinite(record.previousAmount) && record.amount > record.previousAmount) {
      priceIncreaseIds.push(record.id);
    }
  }

  const duplicateGroups = [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.map((record) => record.id));

  const estimatedMonthlySpend = active.reduce(
    (sum, record) => sum + monthlyAmount(record.amount, record.interval),
    0,
  );
  const estimatedMonthlySavingsIfDuplicatesReviewed = duplicateGroups.reduce((sum, ids) => {
    const matching = active.filter((record) => ids.includes(record.id));
    return sum + matching.slice(1).reduce((subtotal, record) => subtotal + monthlyAmount(record.amount, record.interval), 0);
  }, 0);

  return {
    estimatedMonthlySpend: Math.round(estimatedMonthlySpend * 100) / 100,
    duplicateProviderGroups: duplicateGroups,
    priceIncreaseIds,
    incompleteRecordIds,
    estimatedMonthlySavingsIfDuplicatesReviewed: Math.round(estimatedMonthlySavingsIfDuplicatesReviewed * 100) / 100,
  };
}

export interface TokenomicsAuditInput {
  totalSupply: number;
  circulatingSupply: number;
  treasuryTokens: number;
  annualEmissions: number;
  annualStakingRewardBudgetUsd: number;
  stakingDepositsUsd: number;
  advertisedAprPct: number;
  referenceTokenPriceUsd: number;
  maxTreasuryConcentrationPct: number;
  maxAnnualEmissionPct: number;
}

export interface TokenomicsAudit {
  status: "insufficient_data" | "review_required" | "risk_flags";
  treasuryConcentrationPct: number | null;
  annualEmissionPctOfCirculating: number | null;
  estimatedAnnualRewardLiabilityUsd: number | null;
  rewardBudgetCoveragePct: number | null;
  flags: string[];
}

export function auditTokenomics(input: TokenomicsAuditInput): TokenomicsAudit {
  const values = Object.values(input);
  const invalid = values.some((value) => !Number.isFinite(value) || value < 0) ||
    input.totalSupply <= 0 || input.circulatingSupply <= 0 ||
    input.circulatingSupply > input.totalSupply ||
    input.maxTreasuryConcentrationPct > 100 ||
    input.maxAnnualEmissionPct > 100;

  if (invalid) {
    return {
      status: "insufficient_data",
      treasuryConcentrationPct: null,
      annualEmissionPctOfCirculating: null,
      estimatedAnnualRewardLiabilityUsd: null,
      rewardBudgetCoveragePct: null,
      flags: ["Missing, invalid, or inconsistent supply/economic inputs; no sustainability conclusion is possible."],
    };
  }

  const treasuryConcentrationPct = input.treasuryTokens / input.totalSupply * 100;
  const annualEmissionPctOfCirculating = input.annualEmissions / input.circulatingSupply * 100;
  const estimatedAnnualRewardLiabilityUsd = input.stakingDepositsUsd * input.advertisedAprPct / 100;
  const rewardBudgetCoveragePct = estimatedAnnualRewardLiabilityUsd > 0
    ? input.annualStakingRewardBudgetUsd / estimatedAnnualRewardLiabilityUsd * 100
    : null;
  const flags: string[] = [];

  if (treasuryConcentrationPct > input.maxTreasuryConcentrationPct) {
    flags.push("Treasury concentration exceeds the configured review threshold.");
  }
  if (annualEmissionPctOfCirculating > input.maxAnnualEmissionPct) {
    flags.push("Annual emissions exceed the configured review threshold relative to circulating supply.");
  }
  if (estimatedAnnualRewardLiabilityUsd > input.annualStakingRewardBudgetUsd) {
    flags.push("The advertised staking APR implies more annual rewards than the stated reward budget covers.");
  }
  if (input.referenceTokenPriceUsd <= 0) {
    flags.push("A positive reference price is required for USD-denominated tokenomics analysis.");
  }

  return {
    status: flags.length ? "risk_flags" : "review_required",
    treasuryConcentrationPct: Math.round(treasuryConcentrationPct * 100) / 100,
    annualEmissionPctOfCirculating: Math.round(annualEmissionPctOfCirculating * 100) / 100,
    estimatedAnnualRewardLiabilityUsd: Math.round(estimatedAnnualRewardLiabilityUsd * 100) / 100,
    rewardBudgetCoveragePct: rewardBudgetCoveragePct == null ? null : Math.round(rewardBudgetCoveragePct * 100) / 100,
    flags: flags.length ? flags : ["No configured threshold breach detected; this is not approval to launch or a claim of sustainable returns."],
  };
}
