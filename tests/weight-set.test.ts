import { describe, it, expect } from 'vitest';
import { buildConfig, applyOwnerPlan, parseSignalWeightSet } from '@/lib/config';
import { computeSignals, liquidityScore, compositeScore, rankCandidates, scoreFor, LIQUIDITY_WEIGHTS } from '@/lib/signals';
import type { DexPair } from '@/lib/dexscreener';

const pair = (o: { mcap: number; liq: number; m5: number; h1: number; h6: number; h24: number; buys?: number; sells?: number; t5?: number; t1?: number }): DexPair => ({
  chainId: 'solana', dexId: 'raydium', pairAddress: `P${o.mcap}${o.m5}`, url: '',
  baseToken: { address: `M${o.mcap}${o.m5}${o.h1}`, symbol: 'T', name: 'T' }, quoteToken: { address: 'So1', symbol: 'SOL', name: 'SOL' },
  priceUsd: '0.001', marketCap: o.mcap, fdv: o.mcap, liquidity: { usd: o.liq },
  volume: { m5: o.mcap * 0.01, h1: o.mcap * 0.1, h6: o.mcap * 0.4, h24: o.mcap * 1.2 },
  priceChange: { m5: o.m5, h1: o.h1, h6: o.h6, h24: o.h24 },
  txns: { m5: { buys: o.buys ?? 20, sells: o.sells ?? 20 }, h1: { buys: (o.t1 ?? 240) / 2, sells: (o.t1 ?? 240) / 2 } },
  pairCreatedAt: Date.now() - 48 * 3_600_000,
} as unknown as DexPair);

describe('signal weight sets', () => {
  it('SIGNAL_WEIGHT_SET parses, defaults to classic', () => {
    expect(parseSignalWeightSet('liquidity')).toBe('liquidity');
    expect(parseSignalWeightSet(' LIQUIDITY ')).toBe('liquidity');
    expect(parseSignalWeightSet(undefined)).toBe('classic');
    expect(parseSignalWeightSet('bogus')).toBe('classic');
    expect(buildConfig({ SIGNAL_WEIGHT_SET: 'liquidity' }).signalWeightSet).toBe('liquidity');
    expect(buildConfig({}).signalWeightSet).toBe('classic');
  });

  it('liquidity set has no momentum / breakout / buy-pressure / nano-cap weight and sums to 1', () => {
    const w = LIQUIDITY_WEIGHTS as Record<string, number>;
    for (const k of ['momentum', 'breakout', 'microCapHeat', 'nanoCapSpike']) expect(w[k]).toBeUndefined();
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(w.liquidityBuild).toBeGreaterThanOrEqual(0.35);
  });

  it('prefers a dip on deep liquidity over a thin coin that already pumped', () => {
    const deepDip = pair({ mcap: 800_000, liq: 200_000, m5: -2, h1: -3, h6: 12, h24: 20 });
    const thinPump = pair({ mcap: 800_000, liq: 30_000, m5: 9, h1: 60, h6: 150, h24: 400, buys: 60, sells: 5 });
    const opts = { nanoCapMax: 100_000 };
    const dd = liquidityScore(computeSignals(deepDip, opts), deepDip), tp = liquidityScore(computeSignals(thinPump, opts), thinPump);
    expect(dd).toBeGreaterThan(0.6);
    expect(tp).toBeLessThan(0.35);
    // The classic score ranks them the other way round (it chased the pump).
    const cw = buildConfig({}).initialWeights;
    expect(compositeScore(computeSignals(thinPump, opts), cw)).toBeGreaterThan(compositeScore(computeSignals(deepDip, opts), cw));
  });

  it('a $1M coin is not penalised for being above the nano-cap band', () => {
    const big = pair({ mcap: 1_000_000, liq: 250_000, m5: 0, h1: 1, h6: 3, h24: 5 });
    expect(liquidityScore(computeSignals(big, { nanoCapMax: 100_000 }), big)).toBeGreaterThan(0.55);
  });

  it('rankCandidates and scoreFor use the configured set', () => {
    const p = pair({ mcap: 800_000, liq: 200_000, m5: -2, h1: -3, h6: 12, h24: 20 });
    const base = { MIN_MARKET_CAP: '70000', MAX_MARKET_CAP: '5000000', MIN_LIQUIDITY_USD: '0', MIN_TOKEN_AGE_HOURS: '0' };
    const cl = buildConfig({ ...base });
    const lq = buildConfig({ ...base, SIGNAL_WEIGHT_SET: 'liquidity' });
    const a = rankCandidates([p], cl, cl.initialWeights)[0], b = rankCandidates([p], lq, lq.initialWeights)[0];
    expect(b.composite).toBeGreaterThan(a.composite);
    expect(scoreFor('liquidity', b.signals, p, lq.initialWeights)).toBeCloseTo(liquidityScore(b.signals, p), 9);
  });

  it('live threshold wiring: MIN_COMPOSITE_SCORE overrides the CONSERVATIVE live preset; owner daily loss 15%', () => {
    const live = { TRADING_MODE: 'live', TRADING_WALLET_PRIVATE_KEY: 'x', ALLOW_LIVE_IN_BETA: 'true', OWNER_PLAN_ENABLED: 'true' };
    expect(buildConfig(live).minCompositeScore).toBe(0.75);
    const c = applyOwnerPlan(buildConfig({ ...live, MIN_COMPOSITE_SCORE: '0.6', SIGNAL_WEIGHT_SET: 'liquidity' }), true);
    expect(c.mode).toBe('live');
    expect(c.minCompositeScore).toBe(0.6);
    expect(c.signalWeightSet).toBe('liquidity');
    expect(c.maxDailyLossPct).toBe(15);
    expect(applyOwnerPlan(buildConfig({ ...live, OWNER_MAX_DAILY_LOSS_PCT: '10' }), true).maxDailyLossPct).toBe(10);
    // Non-operator accounts keep the global limit.
    expect(applyOwnerPlan(buildConfig(live), false).maxDailyLossPct).toBe(5);
  });
});
