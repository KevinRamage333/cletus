import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY, DEFAULT_WEIGHTS, TERMS, boundStep, boundThreshold, closedTradeIc, decidePromotion, evaluate, generateCandidates,
  makeSplit, mulberry32, normalise, replay, scoreDecision, withinBounds, type Decision, type Simulate, type TermWeights,
} from '../src/lib/retrain/core';
import { activeVersion, isDue, promote, readRegistry, rollback, writeRegistry, logDecision } from '../src/lib/retrain/store';
import { liquidityScore, liquidityTerms, computeSignals, setLiquidityWeights, activeLiquidityWeights, LIQUIDITY_WEIGHTS } from '../src/lib/signals';
import { getConfig, setMinCompositeScoreOverride } from '../src/lib/config';
import type { DexPair } from '../src/lib/dexscreener';

const sum = (w: TermWeights) => TERMS.reduce((a, k) => a + w[k], 0);

describe('bounded nightly step', () => {
  it('never moves a weight by more than the cap, keeps the floor and sums to 1', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const prop = Object.fromEntries(TERMS.map((k) => [k, rng() * 2 - 0.5])) as TermWeights;
      const w = boundStep(DEFAULT_WEIGHTS, prop, 0.05, 0.02);
      expect(sum(w)).toBeCloseTo(1, 9);
      for (const k of TERMS) { expect(Math.abs(w[k] - DEFAULT_WEIGHTS[k])).toBeLessThanOrEqual(0.05 + 1e-9); expect(w[k]).toBeGreaterThanOrEqual(0.02 - 1e-12); }
      expect(withinBounds(DEFAULT_WEIGHTS, w, 0.6, 0.6)).toBe(true);
    }
  });
  it('threshold stays in 0.55-0.75 and moves at most 0.05 per night', () => {
    expect(boundThreshold(0.6, 0.9)).toBe(0.65);
    expect(boundThreshold(0.6, 0.1)).toBe(0.55);
    expect(boundThreshold(0.74, 0.9)).toBe(0.75);
    expect(boundThreshold(0.9, 0.9)).toBe(0.75); // out-of-range current is pulled in first
  });
  it('every generated candidate is within bounds and current comes first', () => {
    const cs = generateCandidates(DEFAULT_WEIGHTS, 0.6, DEFAULT_POLICY, mulberry32(1));
    expect(cs[0].label.startsWith('current@')).toBe(true);
    for (const c of cs) expect(withinBounds(DEFAULT_WEIGHTS, c.weights, 0.6, c.threshold)).toBe(true);
    expect(cs.length).toBe((1 + TERMS.length * 2 + DEFAULT_POLICY.randomCandidates) * 5);
  });
  it('normalise floors and sums to 1', () => {
    const w = normalise({ liquidityBuild: 1 });
    expect(sum(w)).toBeCloseTo(1, 12);
    expect(Math.min(...TERMS.map((k) => w[k]))).toBeGreaterThan(0);
  });
});

const pair = (o: Partial<DexPair> = {}): DexPair => ({
  chainId: 'solana', dexId: 'raydium', pairAddress: 'P', url: '', baseToken: { address: 'M', symbol: 'T', name: 'T' }, quoteToken: { address: 'S', symbol: 'SOL', name: 'SOL' },
  priceUsd: '0.001', marketCap: 300000, fdv: 300000, liquidity: { usd: 50000 }, volume: { m5: 4000, h1: 30000, h6: 120000, h24: 400000 },
  priceChange: { m5: -1, h1: 8, h6: 20, h24: 60 }, txns: { m5: { buys: 30, sells: 20 }, h1: { buys: 200, sells: 150 }, h6: { buys: 900, sells: 800 }, h24: { buys: 3000, sells: 2500 } }, pairCreatedAt: Date.now() - 48 * 3600_000,
  ...o,
} as unknown as DexPair);

describe('scorer parity and overrides', () => {
  afterEach(() => { setLiquidityWeights(null); setMinCompositeScoreOverride(null); });
  it('retrain scoreDecision equals the live liquidityScore for the same weights', () => {
    const p = pair(); const s = computeSignals(p);
    const d = { terms: liquidityTerms(s, p), feePen: 0 };
    expect(scoreDecision(DEFAULT_WEIGHTS, d)).toBeCloseTo(liquidityScore(s, p), 12);
    const w = boundStep(DEFAULT_WEIGHTS, { ...DEFAULT_WEIGHTS, liquidityBuild: 0.3, antiChase: 0.25 }, 0.05);
    setLiquidityWeights(w);
    expect(scoreDecision(w, d)).toBeCloseTo(liquidityScore(s, p), 12);
  });
  it('override is off by default and clears back to the hand-built set', () => {
    expect(activeLiquidityWeights()).toBe(LIQUIDITY_WEIGHTS);
    setLiquidityWeights({ ...DEFAULT_WEIGHTS, liquidityBuild: 0.45, freshness: 0.1 });
    expect(activeLiquidityWeights().liquidityBuild).toBe(0.45);
    setLiquidityWeights(null);
    expect(activeLiquidityWeights()).toBe(LIQUIDITY_WEIGHTS);
  });
  it('threshold override applies to getConfig and clears', () => {
    const base = getConfig().minCompositeScore;
    setMinCompositeScoreOverride(0.66);
    expect(getConfig().minCompositeScore).toBe(0.66);
    setMinCompositeScoreOverride(null);
    expect(getConfig().minCompositeScore).toBe(base);
  });
});

// Synthetic market: term `liquidityBuild` predicts pnl, `freshness` is noise. A candidate leaning on liquidityBuild should win.
function synth(n: number, seed: number): { decisions: Decision[]; sim: Simulate } {
  const rng = mulberry32(seed); const ds: Decision[] = []; const pnl = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const terms = Object.fromEntries(TERMS.map((k) => [k, rng()])) as TermWeights;
    const key = `k${i}`; ds.push({ t: i * 600, key, terms, feePen: 0 });
    pnl.set(key, (terms.liquidityBuild - 0.6) * 30 - (terms.freshness - 0.5) * 30 + (rng() - 0.5) * 6);
  }
  const sim: Simulate = (d) => ({ exitT: d.t + 300, pnlPct: pnl.get(d.key)!, pnlUsd: pnl.get(d.key)! * 0.06 });
  return { decisions: ds, sim };
}

describe('walk-forward evaluation and promotion', () => {
  it('replay holds one position at a time and respects the threshold', () => {
    const ds: Decision[] = [0, 100, 700].map((t, i) => ({ t, key: String(i), terms: { ...DEFAULT_WEIGHTS, liquidityBuild: 1, velocitySurge: 1, volumePersistence: 1, freshness: 1, antiChase: 1, dipInUptrend: 1 }, feePen: 0 }));
    const tr = replay(ds, { weights: DEFAULT_WEIGHTS, threshold: 0.6 }, 0, 10_000, (d) => ({ exitT: d.t + 600, pnlPct: 1, pnlUsd: 1 }));
    expect(tr.length).toBe(2); // t=100 skipped while busy until 600
    expect(replay(ds, { weights: DEFAULT_WEIGHTS, threshold: 1.01 }, 0, 10_000, () => ({ exitT: 0, pnlPct: 1, pnlUsd: 1 })).length).toBe(0);
  });
  it('split puts the newest 30% in holdout and folds inside train', () => {
    const s = makeSplit([0, 1000], DEFAULT_POLICY)!;
    expect(s.holdoutStart).toBeCloseTo(700.7, 1);
    expect(s.folds[s.folds.length - 1].to).toBeCloseTo(s.holdoutStart, 6);
  });
  it('finds and promotes a genuinely better set on synthetic data, within bounds', () => {
    const { decisions, sim } = synth(6000, 3);
    const ev = evaluate(decisions, DEFAULT_WEIGHTS, 0.6, sim, DEFAULT_POLICY, 11)!;
    expect(ev.best.weights.liquidityBuild).toBeGreaterThan(DEFAULT_WEIGHTS.liquidityBuild);
    expect(withinBounds(DEFAULT_WEIGHTS, ev.best.weights, 0.6, ev.best.threshold)).toBe(true);
    const d = decidePromotion(ev, DEFAULT_POLICY, DEFAULT_WEIGHTS, 0.6);
    expect(d.promote, d.reasons.join('; ')).toBe(true);
  });
  it('does not promote on pure noise', () => {
    const rng = mulberry32(5); const ds: Decision[] = []; const pnl = new Map<string, number>();
    for (let i = 0; i < 4000; i++) { const terms = Object.fromEntries(TERMS.map((k) => [k, rng()])) as TermWeights; ds.push({ t: i * 600, key: `k${i}`, terms, feePen: 0 }); pnl.set(`k${i}`, (rng() - 0.5) * 10); }
    const sim: Simulate = (d) => ({ exitT: d.t + 300, pnlPct: pnl.get(d.key)!, pnlUsd: pnl.get(d.key)! * 0.06 });
    let promoted = 0;
    for (const seed of [1, 2, 3, 4, 5]) { const ev = evaluate(ds, DEFAULT_WEIGHTS, 0.6, sim, DEFAULT_POLICY, seed)!; if (decidePromotion(ev, DEFAULT_POLICY, DEFAULT_WEIGHTS, 0.6).promote) promoted++; }
    expect(promoted).toBeLessThanOrEqual(1);
  });
  it('rejects when holdout has too few trades', () => {
    const { decisions, sim } = synth(60, 3);
    const ev = evaluate(decisions, DEFAULT_WEIGHTS, 0.6, sim, DEFAULT_POLICY, 1)!;
    const d = decidePromotion(ev, DEFAULT_POLICY, DEFAULT_WEIGHTS, 0.6);
    expect(d.promote).toBe(false);
  });
  it('closed-trade IC is a rank correlation', () => {
    const tr = [0.1, 0.4, 0.7, 0.9].map((x) => ({ liquidityBuild: x, velocitySurge: 0, momentum: 0.5, pnlPct: x * 10 }));
    expect(closedTradeIc(DEFAULT_WEIGHTS, tr)).toBeCloseTo(1, 6);
    expect(closedTradeIc(DEFAULT_WEIGHTS, tr.slice(0, 2))).toBeNull();
  });
});

describe('versioned registry', () => {
  let dir = '';
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retrain-')); process.env.RETRAIN_REGISTRY_PATH = path.join(dir, 'reg.json'); process.env.RETRAIN_LOG_PATH = path.join(dir, 'log.jsonl'); });
  afterEach(() => { delete process.env.RETRAIN_REGISTRY_PATH; delete process.env.RETRAIN_LOG_PATH; fs.rmSync(dir, { recursive: true, force: true }); });

  it('missing or corrupt registry falls back to the default set', () => {
    expect(activeVersion(readRegistry(0.6)).id).toBe('default');
    fs.writeFileSync(process.env.RETRAIN_REGISTRY_PATH!, '{not json');
    const r = readRegistry(0.6);
    expect(activeVersion(r).id).toBe('default');
    expect(activeVersion(r).threshold).toBe(0.6);
  });
  it('promote, persist, roll back to previous and to default', () => {
    let r = readRegistry(0.6);
    const w = boundStep(DEFAULT_WEIGHTS, { ...DEFAULT_WEIGHTS, liquidityBuild: 0.45 }, 0.05);
    r = promote(r, { id: 'ws-1', createdAt: 'x', source: 'retrain', weights: w, threshold: 0.62, parentId: 'default' });
    r = promote(r, { id: 'ws-2', createdAt: 'x', source: 'retrain', weights: w, threshold: 0.63, parentId: 'ws-1' });
    writeRegistry(r);
    const back = readRegistry(0.6);
    expect(back.activeId).toBe('ws-2'); expect(back.previousId).toBe('ws-1');
    const rb = rollback(back)!; expect(rb.activeId).toBe('ws-1');
    expect(rollback(back, 'default')!.activeId).toBe('default');
    expect(rollback(back, 'nope')).toBeNull();
  });
  it('drops an invalid version and never activates it', () => {
    fs.writeFileSync(process.env.RETRAIN_REGISTRY_PATH!, JSON.stringify({ versions: [{ id: 'bad', weights: { liquidityBuild: 5 }, threshold: 0.6 }], activeId: 'bad', previousId: null, lastRunAt: null, lastRunResult: null }));
    expect(activeVersion(readRegistry(0.6)).id).toBe('default');
  });
  it('catch-up: due when never run or older than the interval', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    expect(isDue({ lastRunAt: null }, now)).toBe(true);
    expect(isDue({ lastRunAt: '2026-11-12T00:00:00Z' }, now)).toBe(false);
    expect(isDue({ lastRunAt: '2026-11-11T12:00:00Z' }, now)).toBe(true);
  });
  it('decision log appends JSON lines', () => {
    logDecision('reject', { a: 1 }); logDecision('promote', { b: 2 });
    const lines = fs.readFileSync(process.env.RETRAIN_LOG_PATH!, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.event)).toEqual(['reject', 'promote']);
  });
});

describe('worker runtime load / rollback', () => {
  let dir = '';
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retrain-rt-')); process.env.RETRAIN_REGISTRY_PATH = path.join(dir, 'reg.json'); process.env.RETRAIN_LOG_PATH = path.join(dir, 'log.jsonl'); });
  afterEach(() => { setLiquidityWeights(null); setMinCompositeScoreOverride(null); delete process.env.RETRAIN_REGISTRY_PATH; delete process.env.RETRAIN_LOG_PATH; fs.rmSync(dir, { recursive: true, force: true }); });
  it('applies the promoted set and threshold, then the default after rollback', async () => {
    const { applyActiveWeightSet, retrainFlags } = await import('../src/lib/retrain/runtime');
    expect(retrainFlags()).toEqual({ load: false, hotReload: false, schedule: false }); // all off by default
    const base = getConfig().minCompositeScore;
    const w = boundStep(DEFAULT_WEIGHTS, { ...DEFAULT_WEIGHTS, liquidityBuild: 0.45, dipInUptrend: 0 }, 0.05);
    let r = promote(readRegistry(base), { id: 'ws-1', createdAt: 'x', source: 'retrain', weights: w, threshold: 0.63, parentId: 'default' });
    writeRegistry(r);
    const logs: string[] = []; const lg = (_: string, m: string) => { logs.push(m); };
    expect(applyActiveWeightSet(lg).id).toBe('ws-1');
    expect(activeLiquidityWeights().liquidityBuild).toBeCloseTo(w.liquidityBuild, 12);
    expect(getConfig().minCompositeScore).toBe(0.63);
    r = rollback(r)!; writeRegistry(r);
    expect(applyActiveWeightSet(lg).id).toBe('default');
    expect(activeLiquidityWeights()).toBe(LIQUIDITY_WEIGHTS);
    expect(getConfig().minCompositeScore).toBe(base);
    expect(logs.length).toBe(2);
    expect(fs.readFileSync(process.env.RETRAIN_LOG_PATH!, 'utf8').trim().split('\n').length).toBe(2);
  });
});
