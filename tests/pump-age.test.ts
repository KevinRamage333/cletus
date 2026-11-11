import { describe, it, expect, afterEach } from 'vitest';
import { computeExitPlan, planWithinBounds, HARD_BOUNDS } from '@/lib/adaptive-exits';
import { parseNewPools } from '@/lib/gecko';
import {
  pumpAgeFromEnv, describePumpAge, findPumpAnchor, listingCovered, evaluatePumpAge,
  applyImpulseExitBias, mergeMints, _resetPumpAgeCache,
} from '@/lib/pump-age';

const cfg = () => pumpAgeFromEnv({ PUMP_AGE_FILTER: 'on' })!;
afterEach(() => { _resetPumpAgeCache(); });

function bars(n: number, opts: { t0?: number; vol?: (i: number) => number; close?: (i: number) => number } = {}) {
  const t0 = opts.t0 ?? 1_700_000_000;
  const vol = opts.vol ?? (() => 100);
  const close = opts.close ?? (() => 1);
  return Array.from({ length: n }, (_, i) => {
    const c = close(i);
    return { time: t0 + i * 300, open: c, high: c, low: c, close: c, volume: vol(i) };
  });
}

describe('pumpAgeFromEnv', () => {
  it('is off unless PUMP_AGE_FILTER=on, and clamps windows', () => {
    expect(pumpAgeFromEnv({})).toBeNull();
    expect(pumpAgeFromEnv({ PUMP_AGE_FILTER: 'off' })).toBeNull();
    const on = pumpAgeFromEnv({ PUMP_AGE_FILTER: 'on', PUMP_AGE_IMPULSE_HOURS: '6', PUMP_AGE_LATE_HOURS: '24' })!;
    expect(on.impulseHours).toBe(6);
    expect(on.lateHours).toBe(24);
    expect(on.blockLateBelowAnchor).toBe(true);
    expect(on.waiveMinTokenAge).toBe(true);
    const clamped = pumpAgeFromEnv({ PUMP_AGE_FILTER: 'on', PUMP_AGE_IMPULSE_HOURS: '99', PUMP_AGE_LATE_HOURS: '1' })!;
    expect(clamped.impulseHours).toBe(24);
    expect(clamped.lateHours).toBeGreaterThanOrEqual(clamped.impulseHours);
    expect(describePumpAge(on)).toMatch(/impulse 0-6h/);
  });
});

describe('findPumpAnchor', () => {
  it('uses the first 3x volume spike vs prior 12-bar median, priced at the previous close', () => {
    const b = bars(20, { vol: (i) => (i === 12 ? 3000 : 100), close: (i) => 1 + i * 0.01 });
    const a = findPumpAnchor(b)!;
    expect(a.source).toBe('volume_spike');
    expect(a.index).toBe(12);
    expect(a.anchorPx).toBeCloseTo(b[11]!.close);
  });
  it('ignores tiny 3x prints below the volume floor and falls back to listing start', () => {
    const b = bars(20, { vol: (i) => (i === 12 ? 3 : 1) });
    const a = findPumpAnchor(b, { volFloor: 10, poolCreatedAtSec: b[0]!.time })!;
    expect(a.source).toBe('listing');
    expect(a.index).toBe(0);
    expect(a.anchorPx).toBe(b[0]!.open);
  });
  it('does not treat a mid-life 3x as the listing pump when candles start long after pool creation', () => {
    const created = 1_700_000_000;
    const b = bars(20, { t0: created + 48 * 3600, vol: (i) => (i === 12 ? 3000 : 100) });
    expect(listingCovered(b, created, 2)).toBe(false);
    const a = findPumpAnchor(b, { poolCreatedAtSec: created })!;
    expect(a.source).toBe('pool_created');
    expect(a.anchorPx).toBeNull();
    expect(a.time).toBe(created);
  });
});

describe('evaluatePumpAge', () => {
  const c = cfg();
  const now = Date.parse('2026-11-11T23:00:00Z');
  it('prefers 0-6h impulse window', () => {
    const ev = evaluatePumpAge({ nowMs: now, price: 2, pairCreatedAtMs: now - 3 * 3_600_000, anchor: { index: 0, time: (now - 3 * 3_600_000) / 1000, anchorPx: 1, source: 'volume_spike' }, cfg: c });
    expect(ev.inImpulse).toBe(true);
    expect(ev.prefer).toBe(true);
    expect(ev.block).toBe(false);
    expect(ev.hoursSincePump).toBeCloseTo(3);
    expect(ev.vsAnchor).toBeCloseTo(2);
  });
  it('blocks >24h after pump and trading below the anchor', () => {
    const ev = evaluatePumpAge({ nowMs: now, price: 0.4, pairCreatedAtMs: now - 56 * 3_600_000, anchor: { index: 0, time: (now - 56 * 3_600_000) / 1000, anchorPx: 1, source: 'volume_spike' }, cfg: c });
    expect(ev.isLate).toBe(true);
    expect(ev.block).toBe(true);
    expect(ev.reason).toMatch(/below anchor/);
  });
  it('down-weights late tokens when the anchor is unknown, and allows late-but-above-anchor', () => {
    const lateNoAnchor = evaluatePumpAge({ nowMs: now, price: 1, pairCreatedAtMs: now - 48 * 3_600_000, anchor: { index: -1, time: (now - 48 * 3_600_000) / 1000, anchorPx: null, source: 'pool_created' }, cfg: c });
    expect(lateNoAnchor.block).toBe(false);
    expect(lateNoAnchor.downWeight).toBe(true);
    expect(lateNoAnchor.scoreBump).toBe(0.05);
    const lateAbove = evaluatePumpAge({ nowMs: now, price: 1.2, pairCreatedAtMs: now - 48 * 3_600_000, anchor: { index: 0, time: (now - 48 * 3_600_000) / 1000, anchorPx: 1, source: 'listing' }, cfg: c });
    expect(lateAbove.block).toBe(false);
    expect(lateAbove.downWeight).toBe(false);
  });
});

describe('applyImpulseExitBias', () => {
  it('tightens the first partial into strength inside hard bounds, and leaves mid-life plans alone', () => {
    const plan = computeExitPlan({ composite: 0.7, liquidityUsd: 80_000, priceChange: { h1: 8, h6: 20, h24: 40, m5: 3 } });
    expect(planWithinBounds(plan)).toBe(true);
    const biased = applyImpulseExitBias(plan, 2, cfg());
    expect(planWithinBounds(biased)).toBe(true);
    expect(biased.partialGainPct).toBeLessThanOrEqual(Math.min(plan.partialGainPct, 25));
    expect(biased.partialGainPct).toBeGreaterThanOrEqual(HARD_BOUNDS.minPartialPct);
    expect(biased.partialSellPct).toBeGreaterThanOrEqual(50);
    expect(biased.takeProfitPct).toBeGreaterThan(biased.partialGainPct);
    expect(applyImpulseExitBias(plan, 30, cfg())).toBe(plan);
  });
});

describe('discovery helpers', () => {
  it('parses GeckoTerminal new_pools and merges mints', () => {
    const parsed = parseNewPools({
      data: [{ type: 'pool', id: 'solana_POOL1', attributes: { address: 'POOL1', pool_created_at: '2026-11-11T00:00:00Z' }, relationships: { base_token: { data: { id: 'solana_MINT1' } } } }],
      included: [{ id: 'solana_MINT1', type: 'token', attributes: { address: 'MINT1', symbol: 'NEW' } }],
    });
    expect(parsed).toEqual([{ mint: 'MINT1', pool: 'POOL1', createdAt: '2026-11-11T00:00:00Z', symbol: 'NEW' }]);
    expect(mergeMints(['A', 'B'], ['B', 'C'])).toEqual(['A', 'B', 'C']);
  });
});
