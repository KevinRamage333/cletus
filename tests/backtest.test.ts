import { describe, it, expect } from 'vitest';
import { snapshotAt, simulateTrade, tradeStats, spearman, reliability, isotonic, wilson, lastIdxAtOrBefore, type Bar, type PoolMeta, type CostModel } from '@/lib/backtest/replay';
import { volumePersistence, trendAlignment, higherLows } from '@/lib/backtest/features';
import type { ExitParams } from '@/lib/exits';

const meta: PoolMeta = { pool: 'P', mint: 'M', symbol: 'T', dex: 'pumpswap', supply: 1_000_000_000, createdAtMs: 0, liqNow: 200_000, priceNow: 0.001 };
const mk = (n: number, f: (i: number) => number, t0 = 1_700_000_000): Bar[] => Array.from({ length: n }, (_, i) => { const c = f(i), o = i ? f(i - 1) : c; return { t: t0 + i * 300, o, h: Math.max(o, c) * 1.001, l: Math.min(o, c) * 0.999, c, v: 1000 + i }; });
const exitP: ExitParams = { stopLossPct: 5, takeProfitPct: 15, breakEvenTriggerPct: 5, enableTrailingStop: true, trailingStopPct: 5, holdTimeMinutes: 30 };
const cost: CostModel = { feeBps: 50, slippageBps: 30, stopSlippageBps: 100, networkUsdPerSide: 0.01 };

describe('backtest replay', () => {
  it('snapshot uses no future candles', () => {
    const bars = mk(200, (i) => 0.001 * (1 + i / 200));
    const a = snapshotAt(bars, 120, meta);
    const future = bars.map((b, i) => (i > 120 ? { ...b, c: b.c * 9, h: b.h * 9, v: 1e9 } : b));
    const b = snapshotAt(future, 120, meta);
    expect(a).toEqual(b);
  });
  it('computes windows by time and respects warm-up', () => {
    const bars = mk(100, () => 0.001);
    expect(snapshotAt(bars, 10, meta)).toBeNull(); // < 6h of history
    const s = snapshotAt(bars, 99, meta)!;
    expect(s.volume!.h1).toBe(bars.slice(88, 100).reduce((x, b) => x + b.v, 0));
    expect(s.marketCap).toBeCloseTo(0.001 * 1e9);
    expect(lastIdxAtOrBefore(bars, bars[5].t + 1)).toBe(5);
  });
  it('round trip on a flat price loses fees + slippage + impact', () => {
    const bars = mk(200, () => 0.001);
    const r = simulateTrade(bars, 100, meta, exitP, [], cost, 500, bars[199].t + 300)!;
    expect(r.reason).toBe('time_exit');
    // 2×50 bps fee + 2×30 bps slippage + 2×0.5% impact ($500 into a $100k quote reserve) ≈ 2.6 %
    expect(r.pnlPct).toBeLessThan(-2.4);
    expect(r.pnlPct).toBeGreaterThan(-2.8);
  });
  it('stop fills at the level (minus stop slippage) when crossed intrabar', () => {
    const bars = mk(200, () => 0.001);
    bars[101] = { ...bars[101], l: 0.0008, c: 0.00085, o: 0.001, h: 0.001 };
    const r = simulateTrade(bars, 100, meta, exitP, [], cost, 500, bars[199].t + 300)!;
    expect(r.reason).toBe('stop_loss');
    expect(r.pnlPct).toBeGreaterThan(-8.5);
    expect(r.pnlPct).toBeLessThan(-5);
  });
  it('take profit triggers', () => {
    const bars = mk(200, () => 0.001);
    bars[101] = { ...bars[101], o: 0.001, l: 0.001, h: 0.0013, c: 0.00125 };
    const r = simulateTrade(bars, 100, meta, exitP, [], cost, 500, bars[199].t + 300)!;
    expect(r.reason).toBe('take_profit');
    expect(r.pnlPct).toBeGreaterThan(12);
  });
  it('stats and calibration helpers', () => {
    const s = tradeStats([{ pnlPct: 10, pnlUsd: 50 }, { pnlPct: -5, pnlUsd: -25 }, { pnlPct: -5, pnlUsd: -25 }]);
    expect(s.hitRate).toBeCloseTo(1 / 3); expect(s.profitFactor).toBeCloseTo(1); expect(s.expectancyPct).toBeCloseTo(0);
    expect(s.maxDrawdownPct).toBeGreaterThan(0);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    const rel = reliability([{ score: 0.1, retPct: 1 }, { score: 0.9, retPct: -1 }], [0, 0.5, 1]);
    expect(rel[0].winRate).toBe(1); expect(rel[1].winRate).toBe(0);
    const iso = isotonic([{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 2, y: 1 }]);
    for (let k = 1; k < iso.length; k++) expect(iso[k].y).toBeGreaterThanOrEqual(iso[k - 1].y);
    const w = wilson(5, 10)!; expect(w[0]).toBeLessThan(0.5); expect(w[1]).toBeGreaterThan(0.5);
  });
  it('pattern features', () => {
    const p = { volume: { m5: 300, h1: 2400, h6: 7200 }, priceChange: { m5: 1, h1: 2, h6: -1, h24: 5 } } as any;
    expect(volumePersistence(p)).toBeGreaterThan(0);
    expect(trendAlignment(p)).toBe(0.75);
    const up = mk(40, (i) => 1 + i * 0.01);
    expect(higherLows(up, 39)).toBe(1);
  });
});
