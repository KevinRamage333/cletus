import { describe, expect, it } from 'vitest';
import { rankStrategyCandidate, strategyMinimumNetEdgeBps, type StrategyCandidate } from '@/lib/strategy-profiles';

const candidate = (overrides: Partial<StrategyCandidate> = {}): StrategyCandidate => ({
  network: 'solana',
  assetAddress: 'TokenMint',
  strategy: 'new-token',
  features: { liquidity: 0.9, volumeQuality: 0.8, momentum: 0.7, activity: 0.8, ageQuality: 0.7, contractSafety: 0.95, volatilityControl: 0.8 },
  expectedMoveBps: 500,
  estimatedRoundTripCostBps: 100,
  riskPenaltyBps: 100,
  ...overrides,
});

describe('shared strategy profiles', () => {
  it('ranks an adequately evidenced new-token candidate after costs', () => {
    const result = rankStrategyCandidate(candidate());
    expect(result.eligible).toBe(true);
    expect(result.estimatedNetEdgeBps).toBe(300);
    expect(result.score).toBeGreaterThan(0);
  });

  it('rejects a candidate whose apparent edge disappears after costs and risk', () => {
    const result = rankStrategyCandidate(candidate({ expectedMoveBps: 220 }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('estimated net edge below strategy minimum');
  });

  it('vetoes weak contract-safety evidence for new tokens', () => {
    const result = rankStrategyCandidate(candidate({
      features: { ...candidate().features, contractSafety: 0.2 },
    }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('contract safety evidence below minimum');
  });

  it('rejects missing or out-of-range features instead of guessing', () => {
    const result = rankStrategyCandidate(candidate({
      features: { ...candidate().features, liquidity: Number.NaN },
    }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('invalid feature: liquidity');
    expect(result.reasons).toContain('feature set is incomplete');
  });

  it('uses a distinct, lower net-edge threshold for established assets', () => {
    expect(strategyMinimumNetEdgeBps('established')).toBeLessThan(strategyMinimumNetEdgeBps('new-token'));
    const result = rankStrategyCandidate(candidate({
      strategy: 'established',
      expectedMoveBps: 120,
      estimatedRoundTripCostBps: 40,
      riskPenaltyBps: 30,
    }));
    expect(result.eligible).toBe(true);
  });
});
