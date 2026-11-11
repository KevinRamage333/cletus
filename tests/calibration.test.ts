import { describe, it, expect } from 'vitest';
import { scoreConfidence } from '@/lib/calibration';

const mk = (predictive: boolean) => ({
  clips: {
    '25': { BALANCED: { n: 1000, pools: 20, baseWinRate: 0.3, baseCi: [0.27, 0.33] as [number, number], meanNetPct: -1, scorePredictive: predictive, testIcLive: -0.1, exits: 'x', threshold: 0.75,
      buckets: [{ lo: 0, hi: 0.5, n: 900, winRate: 0.28, meanRetPct: -1.2, wilsonLo: 0.25, wilsonHi: 0.31 }, { lo: 0.5, hi: 1, n: 100, winRate: 0.45, meanRetPct: 0.5, wilsonLo: 0.36, wilsonHi: 0.55 }] } },
    '500': { BALANCED: { n: 1000, pools: 20, baseWinRate: 0.2, baseCi: [0.18, 0.23] as [number, number], meanNetPct: -3, scorePredictive: false, testIcLive: -0.1, exits: 'x', threshold: 0.75, buckets: [] } },
  },
});

describe('calibration', () => {
  it('uses the preset base rate when the score was not predictive out of sample', () => {
    const c = scoreConfidence(0.9, 'BALANCED', 25, mk(false))!;
    expect(c.basis).toBe('preset_base_rate'); expect(c.winProbability).toBe(0.3); expect(c.note).toMatch(/did not predict/);
  });
  it('uses the score bucket when predictive and the bucket is large enough', () => {
    const c = scoreConfidence(0.9, 'BALANCED', 25, mk(true))!;
    expect(c.basis).toBe('score_bucket'); expect(c.winProbability).toBe(0.45); expect(c.ci95).toEqual([0.36, 0.55]);
  });
  it('picks the nearest clip size and returns null when there is no data', () => {
    expect(scoreConfidence(0.5, 'BALANCED', 400, mk(true))!.clipUsd).toBe(500);
    expect(scoreConfidence(0.5, 'SAFER', 25, mk(true))).toBeNull();
    expect(scoreConfidence(0.5, 'BALANCED', 25, { clips: {} })).toBeNull();
  });
});
