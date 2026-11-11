import { describe, it, expect } from 'vitest';
import { computePositionSize, tierFor } from '@/lib/sizing';
import { buildConfig } from '@/lib/config';

const c = buildConfig({});
const params = { ...c, equityProtectionLevel: 0 };
const base = { equityUsd: 100000, cashUsd: 100000, openExposureUsd: 0, cumulativePnl: 0, recoveryMode: false };

describe('progressive sizing', () => {
  it('tiers: 1.0 / 1.5 / 2.0 / 2.5 / 3.0x with $60k+ = 3.0x', () => {
    expect(tierFor(0, c.tiers).multiplier).toBe(1.0);
    expect(tierFor(10000, c.tiers).multiplier).toBe(1.5);
    expect(tierFor(25000, c.tiers).multiplier).toBe(2.0);
    expect(tierFor(45000, c.tiers).multiplier).toBe(2.5);
    expect(tierFor(60000, c.tiers).multiplier).toBe(3.0);
    expect(tierFor(1_000_000, c.tiers).multiplier).toBe(3.0);
  });
  it('base = min(max position, equity*risk%/SL%) times tier multiplier', () => {
    // MODERATE: max $5000; risk 2%/10% of 100k = 20k -> base 5000
    expect(computePositionSize(base, { ...params, maxTotalExposurePct: 100 }).sizeUsd).toBe(5000);
    expect(computePositionSize({ ...base, cumulativePnl: 25000 }, { ...params, maxTotalExposurePct: 100 }).sizeUsd).toBe(10000);
    expect(computePositionSize({ ...base, cumulativePnl: 70000 }, { ...params, maxTotalExposurePct: 100 }).sizeUsd).toBe(15000);
    // small account: 10k * 2% / 10% = 2000
    expect(computePositionSize({ ...base, equityUsd: 10000, cashUsd: 10000 }, { ...params, maxTotalExposurePct: 100 }).sizeUsd).toBe(2000);
  });
  it('recovery mode and equity protection reduce size', () => {
    expect(computePositionSize({ ...base, recoveryMode: true }, { ...params, maxTotalExposurePct: 100 }).sizeUsd).toBe(2500);
    expect(computePositionSize({ ...base, equityUsd: 9000, cashUsd: 9000 }, { ...params, equityProtectionLevel: 10000, maxTotalExposurePct: 100 }).sizeUsd).toBe(900);
  });
  it('caps by total exposure and cash, zero below min trade', () => {
    expect(computePositionSize({ ...base, openExposureUsd: 24000 }, params).sizeUsd).toBe(1000); // 25% of 100k = 25k room 1k
    expect(computePositionSize({ ...base, cashUsd: 300 }, params).sizeUsd).toBe(300);
    expect(computePositionSize({ ...base, cashUsd: 5 }, params).sizeUsd).toBe(0);
  });
});
