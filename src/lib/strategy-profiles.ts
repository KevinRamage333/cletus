/**
 * Shared, deterministic strategy profiles for Cletus.
 *
 * These profiles rank research candidates; they do not place orders and do not
 * claim predictive edge. Inputs must be measured by a chain-specific adapter.
 * Every candidate must clear an estimated net-edge gate after costs and risk.
 */
import type { NetworkId } from './multichain';

export type StrategyId = 'new-token' | 'established';

export interface StrategyFeatures {
  liquidity: number;
  volumeQuality: number;
  momentum: number;
  activity: number;
  ageQuality: number;
  contractSafety: number;
  volatilityControl: number;
}

export interface StrategyCandidate {
  network: NetworkId;
  assetAddress: string;
  strategy: StrategyId;
  features: StrategyFeatures;
  /** Estimated gross move available to the strategy, in basis points. */
  expectedMoveBps: number;
  /** Round-trip DEX/exchange fees, gas and estimated slippage, in basis points. */
  estimatedRoundTripCostBps: number;
  /** Explicit risk haircut, in basis points; includes uncertainty not in costs. */
  riskPenaltyBps: number;
}

export interface StrategyRank {
  eligible: boolean;
  score: number;
  estimatedNetEdgeBps: number;
  reasons: string[];
  strategy: StrategyId;
}

const FEATURE_KEYS: readonly (keyof StrategyFeatures)[] = [
  'liquidity', 'volumeQuality', 'momentum', 'activity',
  'ageQuality', 'contractSafety', 'volatilityControl',
];

const PROFILES: Record<StrategyId, { weights: StrategyFeatures; minNetEdgeBps: number }> = {
  'new-token': {
    // Early tokens demand stronger liquidity, activity and safety evidence.
    weights: { liquidity: 0.2, volumeQuality: 0.15, momentum: 0.1, activity: 0.15, ageQuality: 0.05, contractSafety: 0.25, volatilityControl: 0.1 },
    minNetEdgeBps: 150,
  },
  established: {
    // Established assets emphasize liquidity, volume quality and controlled volatility.
    weights: { liquidity: 0.25, volumeQuality: 0.2, momentum: 0.15, activity: 0.1, ageQuality: 0.05, contractSafety: 0.1, volatilityControl: 0.15 },
    minNetEdgeBps: 40,
  },
};

export function rankStrategyCandidate(candidate: StrategyCandidate): StrategyRank {
  const reasons: string[] = [];
  const profile = PROFILES[candidate.strategy];
  let weighted = 0;
  let weightTotal = 0;

  for (const key of FEATURE_KEYS) {
    const value = candidate.features[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      reasons.push(`invalid feature: ${key}`);
      continue;
    }
    const weight = profile.weights[key];
    weighted += value * weight;
    weightTotal += weight;
  }

  const numeric = [candidate.expectedMoveBps, candidate.estimatedRoundTripCostBps, candidate.riskPenaltyBps];
  if (numeric.some((v) => !Number.isFinite(v) || v < 0)) reasons.push('invalid edge, cost, or risk estimate');
  if (!candidate.assetAddress.trim()) reasons.push('asset address is required');
  if (weightTotal !== 1) reasons.push('feature set is incomplete');

  const estimatedNetEdgeBps = candidate.expectedMoveBps - candidate.estimatedRoundTripCostBps - candidate.riskPenaltyBps;
  if (candidate.features.contractSafety < 0.7) reasons.push('contract safety evidence below minimum');
  if (estimatedNetEdgeBps < profile.minNetEdgeBps) reasons.push('estimated net edge below strategy minimum');

  return {
    eligible: reasons.length === 0,
    score: reasons.length === 0 ? Math.max(0, Math.min(1, weighted)) : 0,
    estimatedNetEdgeBps: Number.isFinite(estimatedNetEdgeBps) ? estimatedNetEdgeBps : 0,
    reasons,
    strategy: candidate.strategy,
  };
}

/** Expose immutable profile thresholds for UI and tests; no runtime mutation. */
export function strategyMinimumNetEdgeBps(strategy: StrategyId): number {
  return PROFILES[strategy].minNetEdgeBps;
}
