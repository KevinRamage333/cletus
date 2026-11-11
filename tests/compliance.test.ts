import { describe, it, expect } from 'vitest';
import { complianceGate, concentrationCap } from '@/lib/compliance';

const P = { maxVolumeShare: 0.05, maxLiquidityShare: 0.1, washTradeWindowMin: 60, maxTradesPer5Min: 8 };
const now = new Date('2026-11-11T12:00:00Z');
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const base = { mint: 'M', sizeUsd: 500, volume24hUsd: 100000, liquidityUsd: 20000, history: [], now };

describe('compliance gate', () => {
  it('allows a normal trade', () => {
    const r = complianceGate(base, P);
    expect(r.allowed).toBe(true);
    expect(r.adjustedSizeUsd).toBe(500);
  });
  it('blocks a trade exceeding 5% of 24h volume or 10% of liquidity (spec)', () => {
    expect(complianceGate({ ...base, sizeUsd: 2001 }, P).allowed).toBe(false); // liq cap 2000
    expect(complianceGate({ ...base, sizeUsd: 2000 }, P).allowed).toBe(true);
    expect(complianceGate({ ...base, sizeUsd: 1500, volume24hUsd: 20000 }, P).allowed).toBe(false); // vol cap 1000
    expect(concentrationCap(100000, 20000, P)).toBe(2000);
    expect(concentrationCap(20000, 20000, P)).toBe(1000);
    expect(concentrationCap(20000, null, P)).toBe(0);
  });
  it('blocks when liquidity is unknown or caps fall below the minimum trade', () => {
    expect(complianceGate({ ...base, liquidityUsd: null }, P).allowed).toBe(false);
    expect(complianceGate({ ...base, volume24hUsd: 100 }, P).allowed).toBe(false);
  });
  it('blocks wash-trade re-entry inside the window, allows after', () => {
    expect(complianceGate({ ...base, history: [{ mint: 'M', openedAt: minsAgo(50), closedAt: minsAgo(30) }] }, P).allowed).toBe(false);
    expect(complianceGate({ ...base, history: [{ mint: 'M', openedAt: minsAgo(120), closedAt: minsAgo(61) }] }, P).allowed).toBe(true);
    expect(complianceGate({ ...base, history: [{ mint: 'M', openedAt: minsAgo(5), closedAt: null }] }, P).allowed).toBe(false);
  });
  it('blocks when trade velocity exceeds the 5-minute limit', () => {
    const h = Array.from({ length: 4 }, (_, i) => ({ mint: `X${i}`, openedAt: minsAgo(3), closedAt: minsAgo(1) })); // 8 events
    const r = complianceGate({ ...base, history: h }, P);
    expect(r.allowed).toBe(false);
    expect(r.reasons.join()).toMatch(/velocity/);
    expect(complianceGate({ ...base, history: h.slice(0, 3) }, P).allowed).toBe(true);
  });
});
