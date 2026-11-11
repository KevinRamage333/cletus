/**
 * Pump-age / early-life path filter (PUMP_AGE_FILTER=on).
 *
 * Hours since pump start (first 5m bar with volume >= 3x the prior 12-bar median,
 * needing 6 prior bars and a volume floor; fallback = pool creation / first candle)
 * and the live price vs that anchor. Favors tokens still in the 0–6h impulse window;
 * blocks (or heavily down-weights) entries long past the pump that trade below the anchor.
 * Off by default.
 */
import type { Candle } from './gecko';
import { fiveMinuteCandles } from './gecko';
import { HARD_BOUNDS, planWithinBounds, type ExitPlan } from './adaptive-exits';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const flagOn = (v: string | undefined) => ['on', 'true', '1', 'yes'].includes((v ?? '').trim().toLowerCase());
const flagOff = (v: string | undefined) => ['off', 'false', '0', 'no'].includes((v ?? '').trim().toLowerCase());
const num = (v: string | undefined, d: number) => {
  const n = v !== undefined && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

export interface PumpAgeConfig {
  impulseHours: number;
  lateHours: number;
  blockLateBelowAnchor: boolean;
  lateScoreBump: number;
  impulsePartialCap: number;
  impulseSellFloor: number;
  waiveMinTokenAge: boolean;
  discoverFreshPools: boolean;
  volMult: number;
  priorBars: number;
  minPriorBars: number;
  volFloor: number;
  listingCoverHours: number;
  cacheTtlMs: number;
}

export function pumpAgeFromEnv(env: Record<string, string | undefined> = process.env): PumpAgeConfig | null {
  if (!flagOn(env.PUMP_AGE_FILTER)) return null;
  const impulseHours = clamp(num(env.PUMP_AGE_IMPULSE_HOURS, 6), 0.5, 24);
  const lateHours = clamp(Math.max(num(env.PUMP_AGE_LATE_HOURS, 24), impulseHours), 1, 168);
  return {
    impulseHours,
    lateHours,
    blockLateBelowAnchor: !flagOff(env.PUMP_AGE_BLOCK_LATE_BELOW),
    lateScoreBump: clamp(num(env.PUMP_AGE_LATE_SCORE_BUMP, 0.05), 0, 0.15),
    impulsePartialCap: clamp(num(env.PUMP_AGE_IMPULSE_PARTIAL_PCT, 25), HARD_BOUNDS.minPartialPct, HARD_BOUNDS.maxPartialPct),
    impulseSellFloor: clamp(num(env.PUMP_AGE_IMPULSE_SELL_PCT, 50), HARD_BOUNDS.minPartialSellPct, HARD_BOUNDS.maxPartialSellPct),
    waiveMinTokenAge: !flagOff(env.PUMP_AGE_WAIVE_MIN_AGE),
    discoverFreshPools: !flagOff(env.PUMP_AGE_FRESH_POOLS),
    volMult: clamp(num(env.PUMP_AGE_VOL_MULT, 3), 1.5, 10),
    priorBars: Math.round(clamp(num(env.PUMP_AGE_PRIOR_BARS, 12), 4, 48)),
    minPriorBars: Math.round(clamp(num(env.PUMP_AGE_MIN_PRIOR_BARS, 6), 3, 24)),
    volFloor: clamp(num(env.PUMP_AGE_VOL_FLOOR, 10), 0, 10_000),
    listingCoverHours: clamp(num(env.PUMP_AGE_LISTING_COVER_HOURS, 2), 0, 12),
    cacheTtlMs: Math.round(clamp(num(env.PUMP_AGE_CACHE_TTL_MS, 300_000), 30_000, 1_800_000)),
  };
}

export function describePumpAge(cfg: PumpAgeConfig): string {
  return `pump-age filter ON: impulse 0-${cfg.impulseHours}h favored, late >${cfg.lateHours}h below anchor ${cfg.blockLateBelowAnchor ? 'blocked' : 'down-weighted'}, min token age ${cfg.waiveMinTokenAge ? 'waived' : 'kept'}, fresh pools ${cfg.discoverFreshPools ? 'on' : 'off'}`;
}

export type PumpAnchorSource = 'volume_spike' | 'listing' | 'pool_created';

export interface PumpAnchor {
  index: number;
  time: number; // unix seconds
  anchorPx: number | null;
  source: PumpAnchorSource;
}

/** True when the candle series covers the listing, so a 3x volume spike is the listing pump, not a mid-life burst. */
export function listingCovered(bars: Array<{ time: number }>, poolCreatedAtSec: number | null | undefined, coverHours = 2): boolean {
  if (!bars.length) return false;
  if (poolCreatedAtSec == null) {
    // No listing time: treat a short series as "from the start"; a long mid-life window is not the listing pump.
    const spanH = (bars[bars.length - 1]!.time - bars[0]!.time) / 3600;
    return spanH <= 36;
  }
  return bars[0]!.time <= poolCreatedAtSec + coverHours * 3600;
}

/**
 * Pump start = first 5m bar with volume >= 3x the prior 12-bar median (need 6 prior bars and a volume floor
 * on that median so tiny prints aren't anchors). Fallback: first candle when the series covers the listing,
 * else pool creation (no in-window 3x — mid-life spikes are not the listing pump).
 */
export function findPumpAnchor(
  bars: Array<{ time: number; open: number; close: number; volume: number }>,
  opts: { poolCreatedAtSec?: number | null; volMult?: number; priorBars?: number; minPriorBars?: number; volFloor?: number; listingCoverHours?: number } = {},
): PumpAnchor | null {
  const volMult = opts.volMult ?? 3;
  const prior = opts.priorBars ?? 12;
  const minPrior = opts.minPriorBars ?? 6;
  const volFloor = opts.volFloor ?? 10;
  const coverH = opts.listingCoverHours ?? 2;
  if (!bars.length) {
    if (opts.poolCreatedAtSec != null) return { index: -1, time: opts.poolCreatedAtSec, anchorPx: null, source: 'pool_created' };
    return null;
  }
  if (listingCovered(bars, opts.poolCreatedAtSec, coverH)) {
    const start = Math.max(minPrior, 1);
    for (let i = start; i < bars.length; i++) {
      const window = bars.slice(Math.max(0, i - prior), i).map((b) => b.volume);
      const med = median(window);
      if (med >= volFloor && bars[i]!.volume >= volMult * med) {
        const prev = bars[i - 1]!;
        return { index: i, time: bars[i]!.time, anchorPx: prev.close > 0 ? prev.close : bars[i]!.open, source: 'volume_spike' };
      }
    }
    const first = bars[0]!;
    return { index: 0, time: first.time, anchorPx: first.open > 0 ? first.open : first.close, source: 'listing' };
  }
  if (opts.poolCreatedAtSec != null) return { index: -1, time: opts.poolCreatedAtSec, anchorPx: null, source: 'pool_created' };
  return null;
}

export interface PumpAgeDecision {
  enabled: boolean;
  pumpStartMs: number | null;
  hoursSincePump: number | null;
  anchorPx: number | null;
  vsAnchor: number | null;
  source: PumpAnchorSource | null;
  inImpulse: boolean;
  isLate: boolean;
  prefer: boolean;
  block: boolean;
  downWeight: boolean;
  scoreBump: number;
  reason: string | null;
}

export function evaluatePumpAge(input: {
  nowMs: number;
  price: number;
  pairCreatedAtMs?: number | null;
  anchor: PumpAnchor | null;
  cfg: PumpAgeConfig;
}): PumpAgeDecision {
  const { cfg } = input;
  const pumpMs = input.anchor ? input.anchor.time * 1000 : (input.pairCreatedAtMs ?? null);
  const hours = pumpMs != null ? (input.nowMs - pumpMs) / 3_600_000 : null;
  const anchorPx = input.anchor?.anchorPx ?? null;
  const vsAnchor = fin(input.price) && input.price > 0 && fin(anchorPx) && anchorPx > 0 ? input.price / anchorPx : null;
  const inImpulse = hours != null && hours >= 0 && hours <= cfg.impulseHours;
  const isLate = hours != null && hours > cfg.lateHours;
  const below = vsAnchor != null && vsAnchor < 1;
  const block = !!(cfg.blockLateBelowAnchor && isLate && below);
  const downWeight = !block && isLate && (vsAnchor == null || below);
  let reason: string | null = null;
  if (hours == null) reason = 'pump age unknown';
  else if (block) reason = `late ${hours.toFixed(1)}h after pump, ${((1 - (vsAnchor ?? 1)) * 100).toFixed(0)}% below anchor`;
  else if (downWeight) reason = vsAnchor == null
    ? `late ${hours.toFixed(1)}h after pump, anchor unknown (down-weight)`
    : `late ${hours.toFixed(1)}h after pump, below anchor (down-weight)`;
  else if (inImpulse) reason = `impulse window ${hours.toFixed(1)}h after pump${vsAnchor != null ? `, ${vsAnchor.toFixed(2)}x anchor` : ''}`;
  else if (isLate) reason = `late ${hours.toFixed(1)}h after pump, at/above anchor`;
  else reason = `mid-life ${hours.toFixed(1)}h after pump`;
  return {
    enabled: true,
    pumpStartMs: pumpMs,
    hoursSincePump: hours,
    anchorPx,
    vsAnchor,
    source: input.anchor?.source ?? null,
    inImpulse,
    isLate,
    prefer: inImpulse,
    block,
    downWeight,
    scoreBump: downWeight ? cfg.lateScoreBump : 0,
    reason,
  };
}

/** Tighten first partial into strength for entries still in the impulse window. Stays inside HARD_BOUNDS. */
export function applyImpulseExitBias(plan: ExitPlan, hoursSincePump: number | null, cfg: PumpAgeConfig, bounds = HARD_BOUNDS): ExitPlan {
  if (hoursSincePump == null || hoursSincePump < 0 || hoursSincePump > cfg.impulseHours) return plan;
  const partial = Math.round(clamp(Math.min(plan.partialGainPct, cfg.impulsePartialCap), bounds.minPartialPct, bounds.maxPartialPct) * 10) / 10;
  const sell = Math.round(clamp(Math.max(plan.partialSellPct, cfg.impulseSellFloor), bounds.minPartialSellPct, bounds.maxPartialSellPct));
  const takeProfitPct = Math.max(plan.takeProfitPct, partial + 20, bounds.minPartialPct);
  const next: ExitPlan = {
    ...plan,
    partialGainPct: partial,
    partialSellPct: sell,
    breakEvenTriggerPct: partial,
    trailingArmPct: partial,
    takeProfitPct,
    notes: [...plan.notes, `impulse-window (${hoursSincePump.toFixed(1)}h): take profit into strength (partial +${partial}% sell ${sell}%)`],
  };
  if (!planWithinBounds(next, bounds)) return plan;
  return next;
}

const g = globalThis as unknown as { __pumpAgeCache?: Map<string, { at: number; ev: PumpAgeDecision }> };
const cache = (g.__pumpAgeCache ??= new Map());

export function peekPumpAge(mint: string, now = Date.now(), ttlMs = 300_000): PumpAgeDecision | null {
  const hit = cache.get(mint);
  if (!hit || now - hit.at > ttlMs) return null;
  return hit.ev;
}

export function _resetPumpAgeCache(): void { cache.clear(); }

export async function resolvePumpAge(input: {
  mint: string;
  pairAddress?: string | null;
  pairCreatedAtMs?: number | null;
  price: number;
  nowMs?: number;
  candles?: Candle[] | null;
}, env: Record<string, string | undefined> = process.env): Promise<PumpAgeDecision | null> {
  const cfg = pumpAgeFromEnv(env);
  if (!cfg) return null;
  const nowMs = input.nowMs ?? Date.now();
  const hit = cache.get(input.mint);
  if (hit && nowMs - hit.at < cfg.cacheTtlMs && !input.candles) return hit.ev;
  let candles = input.candles ?? null;
  if (!candles && input.pairAddress) {
    try { candles = await fiveMinuteCandles(input.pairAddress, 300); } catch { candles = null; }
  }
  const bars = (candles ?? []).map((c) => ({ time: c.time, open: c.open, close: c.close, volume: c.volume }));
  const poolCreatedAtSec = input.pairCreatedAtMs != null ? input.pairCreatedAtMs / 1000 : null;
  const anchor = findPumpAnchor(bars, {
    poolCreatedAtSec,
    volMult: cfg.volMult,
    priorBars: cfg.priorBars,
    minPriorBars: cfg.minPriorBars,
    volFloor: cfg.volFloor,
    listingCoverHours: cfg.listingCoverHours,
  });
  const ev = evaluatePumpAge({ nowMs, price: input.price, pairCreatedAtMs: input.pairCreatedAtMs, anchor, cfg });
  cache.set(input.mint, { at: nowMs, ev });
  return ev;
}

/** Merge extra mints into a discovery list (deduped, first-seen wins). */
export function mergeMints(base: string[], extra: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of [...base, ...extra]) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}
