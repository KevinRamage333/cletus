import { expectedFeeBps, feePenalty } from './jupiter';
import type { DexPair } from './dexscreener';
import { SIGNAL_NAMES, type SignalName, type SignalWeightSet } from './config';
import { freshness, dipInUptrend, volumePersistence } from './backtest/features';

export type SignalBreakdown = Record<SignalName, number>;

const clamp = (x: number, lo = 0, hi = 1) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0);

/**
 * The 8 Cletus signals, each normalised to [0, 1], computed from DexScreener pair data.
 */
export interface SignalOpts { nanoCapMax: number; volumeSpikeMcapPct?: number; breakout5mPct?: number; buyPressureRatio?: number }

export function computeSignals(p: DexPair, opts: SignalOpts = { nanoCapMax: 100000 }): SignalBreakdown {
  const spikePct = opts.volumeSpikeMcapPct ?? 5, breakoutPct = opts.breakout5mPct ?? 5, buyRatioFull = opts.buyPressureRatio ?? 0.7;
  const vol = p.volume ?? {};
  const pc = p.priceChange ?? {};
  const tx = p.txns;
  const mcap = p.marketCap ?? p.fdv ?? 0;
  const v24 = vol.h24 ?? 0;
    const h1 = pc.h1 ?? 0, m5 = pc.m5 ?? 0, h6 = pc.h6 ?? 0;

  // 1. Volume spike (spec): 5m volume > 5% of market cap => full score; scales linearly below.
  const v5 = vol.m5 ?? 0;
  const volumeSpike = mcap > 0 ? clamp(v5 / mcap / (spikePct / 100)) : 0;

  // 2. Momentum: positive 1h and 5m price change.
  const momentum = clamp(0.7 * clamp(h1 / 30) + 0.3 * clamp(m5 / 10));

  // 3. Momentum breakout (spec): > 5% price increase in 5m => full score; partial credit if the 1h trend also beats the 6h pace.
  const breakout = m5 <= 0 ? 0 : m5 >= breakoutPct ? 1 : clamp(0.7 * (m5 / breakoutPct) + 0.3 * clamp((h1 - Math.max(h6, 0) / 6) / 20));

  // 4. Velocity surge: transactions in last 5m vs average 5m over the hour.
  const t5 = tx ? tx.m5.buys + tx.m5.sells : 0;
  const t1 = tx ? tx.h1.buys + tx.h1.sells : 0;
  const velocitySurge = t1 > 0 ? clamp((t5 / (t1 / 12) - 1) / 2) : 0;

  // 5. Micro-cap heat / buy pressure (spec): buys > 70% of 5m txns => full score.
  const buys = tx?.m5.buys ?? 0, sells = tx?.m5.sells ?? 0;
  const microCapHeat = buys + sells > 0 ? clamp((buys / (buys + sells) - 0.5) / (buyRatioFull - 0.5)) : 0;

  // 6. Nano-cap spike: sub-$nanoCapMax tokens with an active short-term spike.
  const nanoCapSpike = mcap > 0 && mcap < opts.nanoCapMax ? clamp(m5 / 15) * (0.5 + 0.5 * (1 - mcap / opts.nanoCapMax)) : 0;

  // 7. Liquidity build: liquidity depth relative to market cap (bonding-curve pairs w/o liquidity data get a neutral-low 0.3).
  const liq = p.liquidity?.usd;
  const liquidityBuild = liq === undefined || liq === null ? 0.3 : mcap > 0 ? clamp(liq / mcap / 0.2) : 0;

  // 8. Volume / market-cap ratio (turnover).
  const volMcapRatio = mcap > 0 ? clamp(v24 / mcap / 5) : 0;

  return { volumeSpike, momentum, breakout, velocitySurge, microCapHeat, nanoCapSpike, liquidityBuild, volMcapRatio };
}

/** Weighted composite in [0,1]. Weights are normalised so they need not sum to exactly 1. */
export function compositeScore(s: SignalBreakdown, weights: Record<SignalName, number>): number {
  const total = SIGNAL_NAMES.reduce((a, k) => a + Math.max(0, weights[k] ?? 0), 0);
  if (total <= 0) return 0;
  return SIGNAL_NAMES.reduce((a, k) => a + (s[k] ?? 0) * Math.max(0, weights[k] ?? 0), 0) / total;
}

/**
 * `liquidity` weight set. Built from the out-of-sample information coefficients in docs/backtest
 * (Balanced band): liquidityBuild was the only consistently positive signal (IC +0.08..+0.10),
 * velocitySurge / volumePersistence / freshness small positive; momentum, breakout, buy pressure
 * (microCapHeat) and trend alignment were negative, i.e. chasing pumps loses. So: lean on deep,
 * growing liquidity and fresh activity, reward NOT having already pumped (antiChase = 1 - momentum),
 * small credit for a pullback inside a 6h uptrend, and ignore nanoCapSpike (it is 0 above $100k by
 * design, which used to drag every $100k+ coin's score down).
 */
export const LIQUIDITY_WEIGHTS = {
  liquidityBuild: 0.4,
  velocitySurge: 0.15,
  volumePersistence: 0.1,
  freshness: 0.15,
  antiChase: 0.15,
  dipInUptrend: 0.05,
} as const;
export type LiquidityTerm = keyof typeof LIQUIDITY_WEIGHTS;

export function liquidityTerms(s: SignalBreakdown, p: DexPair): Record<LiquidityTerm, number> {
  return {
    liquidityBuild: s.liquidityBuild, velocitySurge: s.velocitySurge, volumePersistence: volumePersistence(p),
    freshness: freshness(p), antiChase: 1 - clamp(s.momentum), dipInUptrend: dipInUptrend(p),
  };
}

/**
 * Promoted retrained weights (src/lib/retrain, flag RETRAINED_WEIGHTS=on). null = the hand-built LIQUIDITY_WEIGHTS.
 * Only the live worker sets this, from data/weight-sets/registry.json; nothing else changes it.
 */
let liquidityOverride: Record<LiquidityTerm, number> | null = null;
export function setLiquidityWeights(w: Record<LiquidityTerm, number> | null): void { liquidityOverride = w ? { ...w } : null; }
export function activeLiquidityWeights(): Readonly<Record<LiquidityTerm, number>> { return liquidityOverride ?? LIQUIDITY_WEIGHTS; }

export function liquidityScore(s: SignalBreakdown, p: DexPair): number {
  const t = liquidityTerms(s, p);
  let tot = 0, acc = 0;
  for (const [k, w] of Object.entries(activeLiquidityWeights()) as Array<[LiquidityTerm, number]>) { tot += w; acc += w * clamp(t[k]); }
  return tot > 0 ? acc / tot : 0;
}

/** Composite for the configured weight set (classic = weighted 8 signals; liquidity = liquidityScore). */
export function scoreFor(set: SignalWeightSet | undefined, s: SignalBreakdown, p: DexPair, weights: Record<SignalName, number>): number {
  return set === 'liquidity' ? liquidityScore(s, p) : compositeScore(s, weights);
}

/**
 * Self-learning update after a closed trade. Signals that were active at entry
 * are amplified on wins and dampened on losses, scaled by their strength, then
 * re-normalised to sum to 1 with a floor so no signal is ever switched off.
 */
export function updateWeights(
  weights: Record<SignalName, number>,
  entrySignals: SignalBreakdown,
  won: boolean,
  opts: { winAmplify: number; lossDampen: number; minWeight: number },
): Record<SignalName, number> {
  const next = { ...weights };
  for (const k of SIGNAL_NAMES) {
    const strength = entrySignals[k] ?? 0;
    if (strength <= 0.1) continue;
    const factor = won ? opts.winAmplify : opts.lossDampen;
    next[k] = next[k] * Math.pow(factor, strength);
  }
  return normaliseWeights(next, opts.minWeight);
}

export function normaliseWeights(w: Record<SignalName, number>, minWeight = 0.02): Record<SignalName, number> {
  const floored = Object.fromEntries(SIGNAL_NAMES.map((k) => [k, Math.max(minWeight, w[k] ?? 0)])) as Record<SignalName, number>;
  const total = SIGNAL_NAMES.reduce((a, k) => a + floored[k], 0);
  return Object.fromEntries(SIGNAL_NAMES.map((k) => [k, floored[k] / total])) as Record<SignalName, number>;
}

export interface ScanCandidate {
  mint: string;
  symbol: string;
  name: string;
  pairAddress: string;
  dexId: string;
  url?: string;
  priceUsd: number;
  marketCap: number;
  volume24h: number;
  liquidityUsd: number | null;
  ageHours: number | null;
  priceChangeH1: number;
  priceChangeH24?: number;
  quoteSymbol?: string;
  volMcap: number;
  signals: SignalBreakdown;
  composite: number;
  /** Expected Jupiter fee per side (bps): 50 for tokens < 24 h old, else 10. Already netted out of `composite`. */
  estFeeBps?: number;
  rejected?: string;
}

export interface ScanFilters {
  volumeSpikeMcapPct?: number; breakout5mPct?: number; buyPressureRatio?: number;
  minMarketCap: number; maxMarketCap: number; minVolume24hUsd: number; minTokenAgeHours: number; maxHourlyPriceMovement: number; nanoCapMax: number;
  minLiquidityUsd?: number; minVolumeMcapRatio?: number; requireKnownAge?: boolean;
  signalWeightSet?: SignalWeightSet;
}

/** Scanner: keep $minMcap-$maxMcap tokens, rank by volume-to-market-cap. */
export function rankCandidates(pairs: DexPair[], f: ScanFilters, weights: Record<SignalName, number>, now = Date.now()): ScanCandidate[] {
  const out: ScanCandidate[] = [];
  for (const p of pairs) {
    const mcap = p.marketCap ?? p.fdv ?? 0;
    const price = Number(p.priceUsd ?? 0);
    const v24 = p.volume?.h24 ?? 0;
    const ageHours = p.pairCreatedAt ? (now - p.pairCreatedAt) / 3_600_000 : null;
    const signals = computeSignals(p, f);
    const c: ScanCandidate = {
      mint: p.baseToken.address, symbol: p.baseToken.symbol, name: p.baseToken.name, pairAddress: p.pairAddress, dexId: p.dexId, url: p.url,
      priceUsd: price, marketCap: mcap, volume24h: v24, liquidityUsd: p.liquidity?.usd ?? null, ageHours,
      priceChangeH1: p.priceChange?.h1 ?? 0, priceChangeH24: p.priceChange?.h24 ?? 0, quoteSymbol: p.quoteToken?.symbol, volMcap: mcap > 0 ? v24 / mcap : 0, signals, composite: scoreFor(f.signalWeightSet, signals, p, weights),
    };
    // Fee-aware score: expectedFeeBps includes Jupiter's age-based platform fee and the 0.5% operator fee (50 bps,
    // which replaces the platform fee when the referral program is active). feePenalty nets the extra round-trip cost.
    c.estFeeBps = expectedFeeBps(ageHours);
    c.composite = Math.max(0, c.composite - feePenalty(c.estFeeBps));
    if (!(price > 0)) c.rejected = 'no price';
    else if (mcap < f.minMarketCap || mcap > f.maxMarketCap) c.rejected = `mcap outside $${f.minMarketCap}-$${f.maxMarketCap}`;
    else if (v24 < f.minVolume24hUsd) c.rejected = `24h volume < $${f.minVolume24hUsd}`;
    else if (f.minVolumeMcapRatio && c.volMcap < f.minVolumeMcapRatio) c.rejected = `24h volume < ${(f.minVolumeMcapRatio * 100).toFixed(0)}% of mcap`;
    else if (f.minLiquidityUsd && !((c.liquidityUsd ?? 0) >= f.minLiquidityUsd)) c.rejected = `pool liquidity < $${f.minLiquidityUsd.toLocaleString()}`;
    else if (ageHours !== null && ageHours < f.minTokenAgeHours) c.rejected = `younger than ${f.minTokenAgeHours}h`;
    else if (f.requireKnownAge && ageHours === null && f.minTokenAgeHours > 0) c.rejected = 'token age unknown';
    else if (Math.abs(c.priceChangeH1) > f.maxHourlyPriceMovement) c.rejected = `1h move > ${f.maxHourlyPriceMovement}%`;
    out.push(c);
  }
  return out.sort((a, b) => (a.rejected ? 1 : 0) - (b.rejected ? 1 : 0) || b.volMcap - a.volMcap);
}
