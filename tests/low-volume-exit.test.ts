import { describe, it, expect } from 'vitest';
import { lowVolConfig, entryVolumeOk, lowVolumeExitReason } from '@/lib/low-volume-exit';
import { applyFirstPartial, firstPartialFromEnv } from '@/lib/first-partial';
import { computeExitPlan, planWithinBounds } from '@/lib/adaptive-exits';

describe('low 5m volume rule', () => {
  it('defaults to $1,500 with a 5-minute grace; 0 disables', () => {
    expect(lowVolConfig({})).toEqual({ minUsd: 1500, graceSec: 300 });
    expect(lowVolConfig({ LOW_VOL_5M_EXIT_USD: '2000', LOW_VOL_5M_GRACE_SEC: '120' })).toEqual({ minUsd: 2000, graceSec: 120 });
    expect(lowVolConfig({ LOW_VOL_5M_EXIT_USD: '0' })).toBeNull();
  });
  it('entry needs known 5m volume >= floor', () => {
    const c = lowVolConfig({})!;
    expect(entryVolumeOk(1500, c).ok).toBe(true);
    expect(entryVolumeOk(1499, c).ok).toBe(false);
    expect(entryVolumeOk(null, c).ok).toBe(false);
  });
  it('exits below the floor only after the grace and on a fresh sample', () => {
    const c = lowVolConfig({})!;
    const opened = 1_000_000;
    expect(lowVolumeExitReason({ m5VolUsd: 800, openedAtMs: opened, sampleAtMs: opened + 200_000, nowMs: opened + 200_000 }, c)).toBeNull();
    expect(lowVolumeExitReason({ m5VolUsd: 800, openedAtMs: opened, sampleAtMs: opened + 301_000, nowMs: opened + 302_000 }, c)).toMatch(/< \$1,500/);
    expect(lowVolumeExitReason({ m5VolUsd: 1600, openedAtMs: opened, sampleAtMs: opened + 400_000, nowMs: opened + 400_000 }, c)).toBeNull();
    expect(lowVolumeExitReason({ m5VolUsd: 800, openedAtMs: opened, sampleAtMs: opened + 400_000, nowMs: opened + 600_000 }, c)).toBeNull();
  });
});

describe('first partial override', () => {
  it('parses env and only moves the partial earlier, inside bounds', () => {
    expect(firstPartialFromEnv({})).toBeNull();
    expect(firstPartialFromEnv({ OWNER_FIRST_PARTIAL: 'pct:20', OWNER_FIRST_PARTIAL_SELL_PCT: '60' })).toEqual({ mode: 'pct', value: 20, sellPct: 60 });
    const plan = computeExitPlan({ composite: 0.7, liquidityUsd: 100_000, priceChange: { h1: 20, m5: 3 } });
    const p = applyFirstPartial(plan, { mode: 'pct', value: 20, sellPct: 60 });
    expect(p.partialGainPct).toBe(Math.max(15, Math.min(20, plan.partialGainPct)));
    expect(p.breakEvenTriggerPct).toBe(p.partialGainPct);
    expect(p.stopLossPct).toBe(plan.stopLossPct);
    expect(planWithinBounds(p)).toBe(true);
  });
});
