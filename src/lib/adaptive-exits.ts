/**
 * Self-directed exits for the live owner: instead of fixed SL/TP constants, each trade gets its own exit
 * plan at entry, computed from
 *   1. the coin's own recent volatility (DexScreener m5/h1/h6/h24 price change -> a %/hour estimate),
 *   2. the entry score and pool liquidity,
 *   3. the market regime (breadth and median 1 h move of the scanned band), and
 *   4. the bot's own closed trades (MFE/MAE of past plans), blended in gradually once there are enough.
 * The stop distance is the risk unit R; the partial take, break-even, trail and final target are R-multiples.
 * Everything is clamped by HARD bounds so no single plan can wreck the small wallet. Pure and unit-tested.
 */
import type { TpRung } from './exits';

export type Regime = 'risk_on' | 'neutral' | 'risk_off';
export interface PriceChange { m5?: number; h1?: number; h6?: number; h24?: number }
export interface RegimeStats { medianH1: number; breadth: number; n: number; at: number }
/** One closed trade's excursions, as % of entry: mfe = best gain seen, mae = worst drawdown seen (positive number). */
export interface PastTrade { mfePct: number; maePct: number; pnlPct: number; stopLossPct: number; won: boolean }

export interface ExitBounds {
  minStopPct: number; maxStopPct: number;
  minPartialPct: number; maxPartialPct: number;
  minPartialSellPct: number; maxPartialSellPct: number;
  minTrailPct: number; maxTrailPct: number;
  maxFinalPct: number;
}
export const HARD_BOUNDS: ExitBounds = {
  minStopPct: 8, maxStopPct: 25,
  minPartialPct: 15, maxPartialPct: 100,
  minPartialSellPct: 33, maxPartialSellPct: 60,
  minTrailPct: 5, maxTrailPct: 15,
  maxFinalPct: 200,
};

export interface ExitPlan {
  version: 1;
  stopLossPct: number;
  partialGainPct: number; partialSellPct: number;
  breakEvenTriggerPct: number;
  trailingArmPct: number; trailingStopPct: number;
  takeProfitPct: number;
  stalePositionMinutes: number; staleBandPct: number;
  /** Inputs, for the log and the learning loop. */
  volPctPerHour: number; regime: Regime; learnedFrom: number; score: number; liquidityUsd: number | null;
  notes: string[];
}

export interface PlanInputs {
  priceChange?: PriceChange | null;
  composite: number;
  liquidityUsd: number | null;
  regime?: RegimeStats | null;
  history?: PastTrade[];
  /** For a position that is already open (recomputed plan): its current P&L %. */
  currentPnlPct?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Estimated |move| per hour (%), blending horizons by sqrt-time scaling. Null data -> 12 %/h (typical small cap). */
export function volatilityPctPerHour(pc: PriceChange | null | undefined): number {
  const parts: Array<[number, number]> = [];
  if (pc) {
    if (fin(pc.m5)) parts.push([Math.abs(pc.m5) * Math.sqrt(12), 0.3]);
    if (fin(pc.h1)) parts.push([Math.abs(pc.h1), 0.4]);
    if (fin(pc.h6)) parts.push([Math.abs(pc.h6) / Math.sqrt(6), 0.2]);
    if (fin(pc.h24)) parts.push([Math.abs(pc.h24) / Math.sqrt(24), 0.1]);
  }
  const w = parts.reduce((s, [, x]) => s + x, 0);
  if (!w) return 12;
  return clamp(parts.reduce((s, [v, x]) => s + v * x, 0) / w, 1, 200);
}

/** Market regime from the scanned band: median 1 h move and share of coins up over 1 h. */
export function regimeOf(r: RegimeStats | null | undefined): Regime {
  if (!r || r.n < 5) return 'neutral';
  if (r.medianH1 <= -3 || r.breadth < 0.35) return 'risk_off';
  if (r.medianH1 >= 3 && r.breadth > 0.6) return 'risk_on';
  return 'neutral';
}

export function regimeStats(h1Changes: number[], now = Date.now()): RegimeStats {
  const xs = h1Changes.filter(fin).sort((a, b) => a - b);
  const n = xs.length;
  const med = n ? (n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2) : 0;
  return { medianH1: med, breadth: n ? xs.filter((x) => x > 0).length / n : 0.5, n, at: now };
}

const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };

/** Minimum past trades before the learning loop is allowed to move anything. */
export const MIN_LEARN_TRADES = 8;

/**
 * Learned adjustments from the bot's own closed trades (bounded, gradual):
 * - stopMult: winners that dipped close to their stop before winning -> widen (up to +15%);
 *   losers that never went green (MFE < 1%) -> the stop width didn't matter, tighten (up to -15%).
 * - partialPct: the 60th-percentile MFE is where a partial take is actually reachable.
 * - weight: n/(n+30), capped at 0.5, so a handful of trades can only nudge the rule-based plan.
 */
export function learnFrom(history: PastTrade[] | undefined): { n: number; weight: number; stopMult: number; partialPct: number | null; note: string | null } {
  const h = (history ?? []).filter((t) => fin(t.mfePct) && fin(t.maePct) && fin(t.stopLossPct) && t.stopLossPct > 0);
  const n = h.length;
  if (n < MIN_LEARN_TRADES) return { n, weight: 0, stopMult: 1, partialPct: null, note: n ? `learning: ${n}/${MIN_LEARN_TRADES} trades, not applied yet` : null };
  const weight = Math.min(0.5, n / (n + 30));
  const winners = h.filter((t) => t.won), losers = h.filter((t) => !t.won);
  const nearStopWins = winners.filter((t) => t.maePct >= 0.8 * t.stopLossPct).length / Math.max(1, winners.length);
  const neverGreen = losers.filter((t) => t.mfePct < 1).length / Math.max(1, losers.length);
  const raw = 1 + 0.3 * nearStopWins - 0.3 * neverGreen * (losers.length / n);
  const stopMult = clamp(1 + (raw - 1) * weight * 2, 0.85, 1.15);
  const partialPct = quantile(h.map((t) => t.mfePct), 0.6);
  return { n, weight, stopMult, partialPct, note: `learned from ${n} trades (weight ${weight.toFixed(2)}, stop x${stopMult.toFixed(2)}, p60 MFE ${partialPct.toFixed(1)}%)` };
}

/** Compute one trade's exit plan (pure). */
export function computeExitPlan(inp: PlanInputs, b: ExitBounds = HARD_BOUNDS): ExitPlan {
  const notes: string[] = [];
  const vol = volatilityPctPerHour(inp.priceChange);
  const regime = regimeOf(inp.regime);
  const score = fin(inp.composite) ? inp.composite : 0.6;
  const liq = inp.liquidityUsd ?? null;

  // Risk unit: ~1.6 hours of typical movement, so ordinary noise doesn't stop us out.
  const scoreF = clamp(0.9 + (score - 0.6), 0.85, 1.15);            // more conviction, more room
  const liqF = liq === null ? 1 : liq < 40_000 ? 1.1 : liq > 250_000 ? 0.9 : 1; // thin pools: wider (slippage); deep: tighter
  const regimeStopF = regime === 'risk_off' ? 0.85 : regime === 'risk_on' ? 1.05 : 1;
  const learned = learnFrom(inp.history);
  let stop = 1.6 * vol * scoreF * liqF * regimeStopF * learned.stopMult;
  stop = clamp(stop, b.minStopPct, b.maxStopPct);
  // A recomputed plan must not stop out an open position just because it was recomputed.
  if (fin(inp.currentPnlPct) && inp.currentPnlPct < 0 && stop < -inp.currentPnlPct + 3) {
    stop = clamp(-inp.currentPnlPct + 3, b.minStopPct, b.maxStopPct);
    notes.push('stop kept below current drawdown (recomputed)');
  }
  stop = round1(stop);

  // Targets as R-multiples, by regime.
  const rPartial = regime === 'risk_on' ? 2.5 : regime === 'risk_off' ? 1.6 : 2.0;
  const rFinal = regime === 'risk_on' ? 7 : regime === 'risk_off' ? 4 : 6;
  let partial = rPartial * stop * (score >= 0.7 ? 1.1 : 1);
  if (learned.partialPct !== null) partial = (1 - learned.weight) * partial + learned.weight * learned.partialPct;
  partial = round1(clamp(partial, b.minPartialPct, b.maxPartialPct));
  const sellPct = Math.round(clamp(regime === 'risk_off' ? 60 : regime === 'risk_on' ? 40 : 50, b.minPartialSellPct, b.maxPartialSellPct));
  const trail = round1(clamp(0.45 * stop * (regime === 'risk_off' ? 0.85 : 1), b.minTrailPct, b.maxTrailPct));
  const final = round1(clamp(rFinal * stop, partial + 20, b.maxFinalPct));
  const staleBand = round1(clamp(0.2 * stop, 2, 5));
  // Quiet coins get less time to move before they free the slot; hot ones get more.
  const staleMin = Math.round(clamp(120 * (vol >= 15 ? 1.25 : vol < 6 ? 0.75 : 1), 60, 180));

  if (learned.note) notes.push(learned.note);
  return {
    version: 1, stopLossPct: stop, partialGainPct: partial, partialSellPct: sellPct,
    breakEvenTriggerPct: partial, trailingArmPct: partial, trailingStopPct: trail, takeProfitPct: final,
    stalePositionMinutes: staleMin, staleBandPct: staleBand,
    volPctPerHour: round1(vol), regime, learnedFrom: learned.n, score: Math.round(score * 1000) / 1000, liquidityUsd: liq, notes,
  };
}

/** True when every level sits inside the hard bounds and the ladder is ordered (defence in depth). */
export function planWithinBounds(p: ExitPlan, b: ExitBounds = HARD_BOUNDS): boolean {
  return p.stopLossPct >= b.minStopPct && p.stopLossPct <= b.maxStopPct
    && p.partialGainPct >= b.minPartialPct && p.partialGainPct <= b.maxPartialPct
    && p.partialSellPct >= b.minPartialSellPct && p.partialSellPct <= b.maxPartialSellPct
    && p.trailingStopPct >= b.minTrailPct && p.trailingStopPct <= b.maxTrailPct
    && p.takeProfitPct <= b.maxFinalPct && p.takeProfitPct > p.partialGainPct;
}

/** The config overrides a plan implies (taper framework: partial -> break-even -> trail -> final). */
export function planOverrides(p: ExitPlan): {
  stopLossPct: number; takeProfitPct: number; tpLadder: TpRung[]; breakEvenTriggerPct: number;
  trailingArmPct: number; trailingStopPct: number; enableTrailingStop: true; stalePositionMinutes: number; staleBandPct: number;
} {
  return {
    stopLossPct: p.stopLossPct, takeProfitPct: p.takeProfitPct,
    tpLadder: [{ gainPct: p.partialGainPct, sellPct: p.partialSellPct }],
    breakEvenTriggerPct: p.breakEvenTriggerPct, trailingArmPct: p.trailingArmPct, trailingStopPct: p.trailingStopPct,
    enableTrailingStop: true, stalePositionMinutes: p.stalePositionMinutes, staleBandPct: p.staleBandPct,
  };
}

export function describePlan(p: ExitPlan): string {
  return `SL -${p.stopLossPct}% | sell ${p.partialSellPct}% at +${p.partialGainPct}% | then break-even stop + ${p.trailingStopPct}% trail | final +${p.takeProfitPct}% | stale ${p.stalePositionMinutes}m ±${p.staleBandPct}% `
    + `(vol ${p.volPctPerHour}%/h, score ${p.score}, liq ${p.liquidityUsd === null ? '?' : `$${Math.round(p.liquidityUsd / 1000)}k`}, ${p.regime}${p.notes.length ? `; ${p.notes.join('; ')}` : ''})`;
}
