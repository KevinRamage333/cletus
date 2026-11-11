/**
 * Nightly self-retraining of the live entry score (liquidity weight set + score threshold). Pure logic only:
 * bounded candidate generation, replay evaluation over pre-simulated decisions, walk-forward selection on the
 * training window, and the promotion rule judged on a held-out window the search never saw.
 * IO lives in ./store (versioned registry + decision log) and scripts/retrain-weights.ts (data + replay).
 */
import { LIQUIDITY_WEIGHTS, type LiquidityTerm } from '../signals';

export type TermWeights = Record<LiquidityTerm, number>;
export const TERMS = Object.keys(LIQUIDITY_WEIGHTS) as LiquidityTerm[];
export const DEFAULT_WEIGHTS: TermWeights = { ...LIQUIDITY_WEIGHTS };

export interface RetrainPolicy {
  /** Max absolute change of any single weight per night (weights sum to 1). */
  maxWeightDelta: number;
  /** Floor so no term is ever switched off. */
  minWeight: number;
  /** Threshold stays inside [thrMin, thrMax] and moves at most thrMaxStep per night. */
  thrMin: number; thrMax: number; thrMaxStep: number;
  /** Held-out share of the time range (the newest part), never seen by the search. */
  holdoutFrac: number;
  /** Walk-forward folds inside the training window (expanding train, next block = validation). */
  folds: number;
  /** Promotion gates on the held-out window. */
  minHoldoutTrades: number;
  /**
   * Objective = summed pnl% of the 1-slot strategy (net growth in units of 1% of one trade's size; size-free $).
   * Candidate's holdout sum must beat current's by at least this (25 = a quarter of one trade size).
   */
  minMarginSumPct: number;
  /** ...and its mean pnl% per trade may not be worse than current's by more than this (no buying growth with worse trades). */
  maxExpDropPct: number;
  /** Holdout split into this many blocks; candidate must not lose to current in more than half of them. */
  holdoutBlocks: number;
  /** Optional veto from real closed trades: if n >= this, candidate's rank-correlation must not drop by more than maxIcDrop. */
  closedTradesMinN: number; maxIcDrop: number;
  /** Number of random bounded candidates tried per night (plus the systematic one-term moves). */
  randomCandidates: number;
}

export const DEFAULT_POLICY: RetrainPolicy = {
  maxWeightDelta: 0.05, minWeight: 0.02,
  thrMin: 0.55, thrMax: 0.75, thrMaxStep: 0.05,
  holdoutFrac: 0.3, folds: 3,
  minHoldoutTrades: 15, minMarginSumPct: 25, maxExpDropPct: 0.25, holdoutBlocks: 3,
  closedTradesMinN: 20, maxIcDrop: 0.1,
  randomCandidates: 60,
};

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Sum-to-1 with a floor. */
export function normalise(w: Partial<TermWeights>, minWeight = DEFAULT_POLICY.minWeight): TermWeights {
  const f = Object.fromEntries(TERMS.map((k) => [k, Math.max(minWeight, Number.isFinite(w[k]) ? (w[k] as number) : 0)])) as TermWeights;
  const tot = TERMS.reduce((a, k) => a + f[k], 0);
  return Object.fromEntries(TERMS.map((k) => [k, f[k] / tot])) as TermWeights;
}

/**
 * Project a proposal onto the allowed set: each weight within ±maxDelta of `cur`, >= minWeight, sum 1.
 * Iterative clamp + renormalise converges quickly for these sizes; the final pass is a hard clamp with the
 * residual spread over terms that still have room, so the per-weight cap is never exceeded.
 */
export function boundStep(cur: TermWeights, proposal: Partial<TermWeights>, maxDelta: number, minWeight = DEFAULT_POLICY.minWeight): TermWeights {
  const lo = (k: LiquidityTerm) => Math.max(minWeight, cur[k] - maxDelta);
  const hi = (k: LiquidityTerm) => Math.min(1, cur[k] + maxDelta);
  let w = Object.fromEntries(TERMS.map((k) => [k, clamp(Number.isFinite(proposal[k]) ? (proposal[k] as number) : cur[k], lo(k), hi(k))])) as TermWeights;
  for (let it = 0; it < 50; it++) {
    const s = TERMS.reduce((a, k) => a + w[k], 0);
    const resid = 1 - s;
    if (Math.abs(resid) < 1e-12) break;
    const room = TERMS.filter((k) => (resid > 0 ? w[k] < hi(k) - 1e-15 : w[k] > lo(k) + 1e-15));
    if (!room.length) break;
    const share = resid / room.length;
    for (const k of room) w[k] = clamp(w[k] + share, lo(k), hi(k));
  }
  const s = TERMS.reduce((a, k) => a + w[k], 0);
  if (Math.abs(s - 1) > 1e-9) w = Object.fromEntries(TERMS.map((k) => [k, w[k] / s])) as TermWeights; // only if infeasible (never with sane caps)
  return w;
}

export function boundThreshold(cur: number, proposal: number, p: RetrainPolicy = DEFAULT_POLICY): number {
  const c = clamp(cur, p.thrMin, p.thrMax);
  return r4(clamp(clamp(proposal, c - p.thrMaxStep, c + p.thrMaxStep), p.thrMin, p.thrMax));
}

export function withinBounds(cur: TermWeights, next: TermWeights, curThr: number, nextThr: number, p: RetrainPolicy = DEFAULT_POLICY): boolean {
  const sum = TERMS.reduce((a, k) => a + next[k], 0);
  return Math.abs(sum - 1) < 1e-6
    && TERMS.every((k) => next[k] >= p.minWeight - 1e-9 && Math.abs(next[k] - cur[k]) <= p.maxWeightDelta + 1e-9)
    && nextThr >= p.thrMin - 1e-9 && nextThr <= p.thrMax + 1e-9 && Math.abs(nextThr - clamp(curThr, p.thrMin, p.thrMax)) <= p.thrMaxStep + 1e-9;
}

/** Deterministic PRNG so a night's search is reproducible from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface Candidate { weights: TermWeights; threshold: number; label: string }

/** Current set, every single-term ±delta move, threshold steps, and random bounded moves. All within bounds. */
export function generateCandidates(cur: TermWeights, curThr: number, p: RetrainPolicy, rng: () => number): Candidate[] {
  const thrs = [...new Set([-p.thrMaxStep, -p.thrMaxStep / 2, 0, p.thrMaxStep / 2, p.thrMaxStep].map((d) => boundThreshold(curThr, curThr + d, p)))];
  const ws: Array<{ w: TermWeights; label: string }> = [{ w: cur, label: 'current' }];
  for (const k of TERMS) for (const s of [1, -1]) ws.push({ w: boundStep(cur, { ...cur, [k]: cur[k] + s * p.maxWeightDelta }, p.maxWeightDelta, p.minWeight), label: `${k}${s > 0 ? '+' : '-'}` });
  for (let i = 0; i < p.randomCandidates; i++) {
    const prop = Object.fromEntries(TERMS.map((k) => [k, cur[k] + (rng() * 2 - 1) * p.maxWeightDelta])) as TermWeights;
    ws.push({ w: boundStep(cur, prop, p.maxWeightDelta, p.minWeight), label: `rand${i}` });
  }
  const out: Candidate[] = [];
  for (const { w, label } of ws) for (const t of thrs) out.push({ weights: w, threshold: t, label: `${label}@${t.toFixed(3)}` });
  return out;
}

/** One replayable decision: a scanner-eligible snapshot with its 6 liquidity terms and fee penalty. */
export interface Decision { t: number; key: string; terms: TermWeights; feePen: number }

export function scoreDecision(w: TermWeights, d: Pick<Decision, 'terms' | 'feePen'>): number {
  let tot = 0, acc = 0;
  for (const k of TERMS) { tot += w[k]; acc += w[k] * clamp(d.terms[k], 0, 1); }
  return Math.max(0, (tot > 0 ? acc / tot : 0) - d.feePen);
}

export interface SimTrade { exitT: number; pnlPct: number; pnlUsd: number }
/** Trade simulator: given a decision and its score (the adaptive exit plan depends on score), returns the outcome or null (censored / no fill). */
export type Simulate = (d: Decision, score: number) => SimTrade | null;

export interface Metrics { n: number; hit: number; expPct: number; sumPct: number; usd: number; worstPct: number }
export function metricsOf(tr: SimTrade[]): Metrics {
  const n = tr.length;
  return {
    n,
    hit: n ? r4(tr.filter((x) => x.pnlUsd > 0).length / n) : 0,
    expPct: n ? r4(tr.reduce((s, x) => s + x.pnlPct, 0) / n) : 0,
    sumPct: r4(tr.reduce((s, x) => s + x.pnlPct, 0)),
    usd: r4(tr.reduce((s, x) => s + x.pnlUsd, 0)),
    worstPct: n ? r4(Math.min(...tr.map((x) => x.pnlPct))) : 0,
  };
}

/** Replay with 1 open position (the live owner setup): highest score first within a bar, skip while busy. */
export function replay(decisions: Decision[], c: Pick<Candidate, 'weights' | 'threshold'>, from: number, to: number, sim: Simulate): SimTrade[] {
  const q: Array<{ d: Decision; s: number }> = [];
  for (const d of decisions) { if (d.t < from || d.t >= to) continue; const s = scoreDecision(c.weights, d); if (s >= c.threshold) q.push({ d, s }); }
  q.sort((a, b) => a.d.t - b.d.t || b.s - a.s);
  let busy = -Infinity; const out: SimTrade[] = [];
  for (const { d, s } of q) {
    if (d.t < busy) continue;
    const o = sim(d, s);
    if (!o || o.exitT > to) continue;
    busy = o.exitT; out.push(o);
  }
  return out;
}

export interface Split { start: number; holdoutStart: number; end: number; folds: Array<{ from: number; to: number }> }
export function makeSplit(times: number[], p: RetrainPolicy): Split | null {
  if (!times.length) return null;
  let start = Infinity, end = -Infinity; for (const t of times) { if (t < start) start = t; if (t > end) end = t; }
  end += 1;
  if (!(end - start > 0)) return null;
  const holdoutStart = start + (1 - p.holdoutFrac) * (end - start);
  // Walk-forward inside train: first block is warm-up, then `folds` validation blocks.
  const blk = (holdoutStart - start) / (p.folds + 1);
  const folds = Array.from({ length: p.folds }, (_, i) => ({ from: start + (i + 1) * blk, to: start + (i + 2) * blk }));
  return { start, holdoutStart, end, folds };
}

/**
 * Walk-forward fitness on the training window: the worse half of the per-fold summed pnl% (mean of the folds minus
 * half their spread), so a set that only wins one fold does not beat a set that wins steadily.
 */
export function trainFitness(decisions: Decision[], c: Candidate, split: Split, sim: Simulate): { fitness: number; trades: number; folds: Metrics[] } {
  const folds = split.folds.map((f) => metricsOf(replay(decisions, c, f.from, f.to, sim)));
  const trades = folds.reduce((a, m) => a + m.n, 0);
  const xs = folds.map((m) => m.sumPct); const mean = xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, xs.length));
  return { fitness: r4(mean - 0.5 * sd), trades, folds };
}

export interface ClosedTrade { liquidityBuild: number; velocitySurge: number; momentum: number; pnlPct: number }
/**
 * Diagnostic on real closed trades (live + paper). Their entry snapshot only stores the classic 8 signals, so this
 * uses the 3 liquidity terms that can be rebuilt (liquidityBuild, velocitySurge, antiChase = 1 - momentum) and
 * reports the Spearman rank correlation of the partial score with realised pnl%. Used only as a veto.
 */
export function closedTradeIc(w: TermWeights, trades: ClosedTrade[]): number | null {
  if (trades.length < 3) return null;
  const s = trades.map((t) => w.liquidityBuild * t.liquidityBuild + w.velocitySurge * t.velocitySurge + w.antiChase * (1 - clamp(t.momentum, 0, 1)));
  return spearman(s, trades.map((t) => t.pnlPct));
}
function rankOf(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; }
  return r;
}
export function spearman(a: number[], b: number[]): number | null {
  const ra = rankOf(a), rb = rankOf(b); const n = a.length; if (n < 3) return null;
  const ma = ra.reduce((x, y) => x + y, 0) / n, mb = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return da > 0 && db > 0 ? r4(num / Math.sqrt(da * db)) : null;
}

export interface Evaluation {
  current: { train: number; holdout: Metrics; blocks: Metrics[]; ic: number | null };
  best: { label: string; weights: TermWeights; threshold: number; train: number; holdout: Metrics; blocks: Metrics[]; ic: number | null };
  candidatesTried: number; decisions: number; split: Split; closedTrades: number;
}

export interface Decision_ { promote: boolean; reasons: string[] }

/** The promotion rule. Every gate must pass; reasons list all failures (or the passes on promotion). */
export function decidePromotion(e: Evaluation, p: RetrainPolicy, curWeights: TermWeights, curThr: number): Decision_ {
  const fail: string[] = []; const pass: string[] = [];
  const b = e.best, c = e.current;
  if (b.label.startsWith('current@') && Math.abs(b.threshold - curThr) < 1e-9) fail.push('search kept the current set (nothing better on the training folds)');
  if (!withinBounds(curWeights, b.weights, curThr, b.threshold, p)) fail.push('candidate outside nightly bounds');
  if (b.holdout.n < p.minHoldoutTrades) fail.push(`holdout trades ${b.holdout.n} < ${p.minHoldoutTrades}`); else pass.push(`holdout trades ${b.holdout.n}`);
  const margin = b.holdout.sumPct - c.holdout.sumPct;
  if (!(margin >= p.minMarginSumPct)) fail.push(`holdout margin ${margin.toFixed(1)} < ${p.minMarginSumPct} (summed pnl%: cand ${b.holdout.sumPct.toFixed(1)} vs current ${c.holdout.sumPct.toFixed(1)})`); else pass.push(`holdout margin +${margin.toFixed(1)} summed pnl%`);
  if (b.holdout.expPct < c.holdout.expPct - p.maxExpDropPct) fail.push(`per-trade expectancy worse (${b.holdout.expPct.toFixed(2)}% vs ${c.holdout.expPct.toFixed(2)}%)`);
  const lost = b.blocks.filter((m, i) => m.sumPct < (c.blocks[i]?.sumPct ?? 0)).length;
  if (lost > Math.floor(b.blocks.length / 2)) fail.push(`lost to current in ${lost}/${b.blocks.length} holdout blocks`); else pass.push(`won/tied ${b.blocks.length - lost}/${b.blocks.length} holdout blocks`);
  if (e.closedTrades >= p.closedTradesMinN && b.ic !== null && c.ic !== null && b.ic < c.ic - p.maxIcDrop) fail.push(`closed-trade IC drops ${c.ic.toFixed(3)} -> ${b.ic.toFixed(3)}`);
  return fail.length ? { promote: false, reasons: fail } : { promote: true, reasons: pass };
}

/** Full nightly evaluation: search on train folds, then score current and the train-best on the untouched holdout. */
export function evaluate(decisions: Decision[], curWeights: TermWeights, curThr: number, sim: Simulate, p: RetrainPolicy, seed: number, closed: ClosedTrade[] = []): Evaluation | null {
  const split = makeSplit(decisions.map((d) => d.t), p);
  if (!split) return null;
  const cands = generateCandidates(curWeights, curThr, p, mulberry32(seed));
  let best: { c: Candidate; f: number; trades: number } | null = null;
  let curFit = 0;
  for (const c of cands) {
    const r = trainFitness(decisions, c, split, sim);
    if (c.label === `current@${boundThreshold(curThr, curThr, p).toFixed(3)}`) curFit = r.fitness;
    // ties keep the earlier (current first, smaller moves first)
    if (!best || r.fitness > best.f + 1e-9) best = { c, f: r.fitness, trades: r.trades };
  }
  const hb = (w: Pick<Candidate, 'weights' | 'threshold'>) => {
    const step = (split.end - split.holdoutStart) / p.holdoutBlocks;
    return Array.from({ length: p.holdoutBlocks }, (_, i) => metricsOf(replay(decisions, w, split.holdoutStart + i * step, split.holdoutStart + (i + 1) * step, sim)));
  };
  const cur = { weights: curWeights, threshold: curThr };
  const b = best!.c;
  return {
    current: { train: curFit, holdout: metricsOf(replay(decisions, cur, split.holdoutStart, split.end, sim)), blocks: hb(cur), ic: closedTradeIc(curWeights, closed) },
    best: { label: b.label, weights: b.weights, threshold: b.threshold, train: best!.f, holdout: metricsOf(replay(decisions, b, split.holdoutStart, split.end, sim)), blocks: hb(b), ic: closedTradeIc(b.weights, closed) },
    candidatesTried: cands.length, decisions: decisions.length, split, closedTrades: closed.length,
  };
}
