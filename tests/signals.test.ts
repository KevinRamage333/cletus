import { describe, it, expect } from 'vitest';
import { computeSignals, compositeScore, updateWeights, normaliseWeights, rankCandidates } from '@/lib/signals';
import { SIGNAL_NAMES, buildConfig } from '@/lib/config';
import type { DexPair } from '@/lib/dexscreener';

const pair = (o: Partial<DexPair> & { mcap?: number; mint?: string } = {}): DexPair => ({
  chainId: 'solana', dexId: 'raydium', pairAddress: 'P' + (o.mint ?? 'x'),
  baseToken: { address: o.mint ?? 'MintA', name: 'Test', symbol: 'TST' }, quoteToken: { address: 'So1', symbol: 'SOL' },
  priceUsd: '0.001', marketCap: o.mcap ?? 50000,
  volume: { h24: 240000, h1: 40000, m5: 5000 }, priceChange: { m5: 6, h1: 20, h6: 30 },
  txns: { m5: { buys: 40, sells: 10 }, h1: { buys: 300, sells: 100 }, h6: { buys: 900, sells: 600 }, h24: { buys: 2000, sells: 1800 } },
  liquidity: { usd: 15000 }, pairCreatedAt: Date.now() - 5 * 3600_000, ...o,
});

describe('signals', () => {
  it('computes all 8 signals in [0,1]', () => {
    const s = computeSignals(pair());
    expect(Object.keys(s).sort()).toEqual([...SIGNAL_NAMES].sort());
    for (const v of Object.values(s)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(s.volumeSpike).toBeCloseTo(5000 / 50000 / 0.05 > 1 ? 1 : 5000 / 50000 / 0.05, 5);
    expect(s.microCapHeat).toBe(1); // 80% of 5m txns are buys (> 70%)
    expect(s.breakout).toBe(1); // +6% in 5m (> 5%)
    expect(s.volMcapRatio).toBeCloseTo(240000 / 50000 / 5, 5);
  });
  it('volume spike follows the spec: 5m volume > 5% of market cap', () => {
    expect(computeSignals(pair({ mcap: 100000, volume: { h24: 50000, h1: 10000, m5: 5000 } })).volumeSpike).toBe(1); // exactly 5%
    expect(computeSignals(pair({ mcap: 100000, volume: { h24: 50000, h1: 10000, m5: 2500 } })).volumeSpike).toBeCloseTo(0.5, 6);
    expect(computeSignals(pair({ mcap: 100000, volume: { h24: 50000, h1: 10000, m5: 0 } })).volumeSpike).toBe(0);
  });
  it('buy pressure: buys > 70% of 5m txns is full; 50% is zero', () => {
    expect(computeSignals(pair({ txns: { m5: { buys: 71, sells: 29 }, h1: { buys: 1, sells: 1 }, h6: { buys: 1, sells: 1 }, h24: { buys: 1, sells: 1 } } })).microCapHeat).toBe(1);
    expect(computeSignals(pair({ txns: { m5: { buys: 50, sells: 50 }, h1: { buys: 1, sells: 1 }, h6: { buys: 1, sells: 1 }, h24: { buys: 1, sells: 1 } } })).microCapHeat).toBe(0);
  });
  it('scores a dead token near zero', () => {
    const s = computeSignals(pair({ volume: { h24: 1000, h1: 0, m5: 0 }, priceChange: { m5: -5, h1: -20, h6: -40 }, txns: { m5: { buys: 0, sells: 1 }, h1: { buys: 1, sells: 9 }, h6: { buys: 1, sells: 9 }, h24: { buys: 1, sells: 9 } } }));
    expect(compositeScore(s, buildConfig({}).initialWeights)).toBeLessThan(0.15);
  });
  it('composite is a weighted average', () => {
    const s = Object.fromEntries(SIGNAL_NAMES.map((k) => [k, 0])) as Record<(typeof SIGNAL_NAMES)[number], number>;
    s.momentum = 1;
    const w = Object.fromEntries(SIGNAL_NAMES.map((k) => [k, k === 'momentum' ? 0.5 : 0.5 / 7])) as typeof s;
    expect(compositeScore(s, w)).toBeCloseTo(0.5, 6);
  });
  it('self-learning: amplifies active signals on a win, dampens on a loss, stays normalised', () => {
    const w0 = normaliseWeights(buildConfig({}).initialWeights);
    const entry = Object.fromEntries(SIGNAL_NAMES.map((k) => [k, 0])) as typeof w0;
    entry.momentum = 1;
    const opts = { winAmplify: 1.15, lossDampen: 0.85, minWeight: 0.02 };
    const win = updateWeights(w0, entry, true, opts);
    const loss = updateWeights(w0, entry, false, opts);
    expect(win.momentum).toBeGreaterThan(w0.momentum);
    expect(loss.momentum).toBeLessThan(w0.momentum);
    for (const w of [win, loss]) expect(SIGNAL_NAMES.reduce((a, k) => a + w[k], 0)).toBeCloseTo(1, 9);
    // floor keeps every signal alive after many losses
    let w = w0;
    for (let i = 0; i < 200; i++) w = updateWeights(w, entry, false, opts);
    expect(w.momentum).toBeGreaterThan(0.015);
  });
});

describe('scanner', () => {
  const f = { minMarketCap: 10000, maxMarketCap: 500000, minVolume24hUsd: 10000, minTokenAgeHours: 1, maxHourlyPriceMovement: 50, nanoCapMax: 100000 };
  const w = buildConfig({}).initialWeights;
  it('filters by $10k-$500k market cap, volume, age, hourly move', () => {
    const r = rankCandidates([
      pair({ mint: 'small', mcap: 5000 }), pair({ mint: 'big', mcap: 900000 }), pair({ mint: 'ok', mcap: 100000 }),
      pair({ mint: 'young', pairCreatedAt: Date.now() - 10 * 60_000 }), pair({ mint: 'pump', priceChange: { m5: 1, h1: 120, h6: 150 } }),
      pair({ mint: 'novol', volume: { h24: 500, h1: 10, m5: 1 } }),
    ], f, w);
    const ok = r.filter((x) => !x.rejected).map((x) => x.mint);
    expect(ok).toEqual(['ok']);
  });
  it('ranks eligible tokens by volume-to-market-cap', () => {
    const r = rankCandidates([pair({ mint: 'a', mcap: 200000 }), pair({ mint: 'b', mcap: 40000 }), pair({ mint: 'c', mcap: 100000 })], f, w);
    expect(r.map((x) => x.mint)).toEqual(['b', 'c', 'a']);
  });
});
