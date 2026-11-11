/**
 * Candidate "pattern" features evaluated by the backtest. All of them except `higherLows` are computed from the same
 * DexScreener pair snapshot the live scanner already has, so they can ship without extra API calls.
 */
import type { DexPair } from '../dexscreener';
import type { Bar } from './replay';

const clamp = (x: number, lo = 0, hi = 1) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0);

/** Volume-spike persistence: the 5m rate beats the 1h rate AND the 1h rate beats the 6h rate (acceleration that lasts). */
export function volumePersistence(p: DexPair): number {
  const v5 = p.volume?.m5 ?? 0, v1 = p.volume?.h1 ?? 0, v6 = p.volume?.h6 ?? 0;
  if (!(v1 > 0) || !(v6 > 0)) return 0;
  const r5 = v5 / (v1 / 12), r1 = (v1 / 12) / (v6 / 72);
  return clamp((Math.min(r5, r1) - 1) / 1.5);
}
/** Trend alignment across horizons (a snapshot proxy for a higher-lows structure). */
export function trendAlignment(p: DexPair): number {
  const pc = p.priceChange ?? {};
  return [pc.m5, pc.h1, pc.h6, pc.h24].filter((x) => (x ?? 0) > 0).length / 4;
}
/** Not over-extended: 1 when the 24h move is flat, 0 when the token already ran +300% or more in 24h. */
export function freshness(p: DexPair): number { return 1 - clamp((p.priceChange?.h24 ?? 0) / 300); }
/** Pullback-in-uptrend: 6h up while the last 5m dipped (buy-the-dip pattern). */
export function dipInUptrend(p: DexPair): number {
  const pc = p.priceChange ?? {};
  return (pc.h6 ?? 0) > 5 && (pc.m5 ?? 0) < 0 ? clamp(-(pc.m5 ?? 0) / 5) : 0;
}
/** Candle-based higher lows: lows of the last three 30-minute windows strictly rising (research only; needs candles). */
export function higherLows(bars: Bar[], i: number): number {
  const w = 6; if (i < 3 * w) return 0;
  const lows = [0, 1, 2].map((k) => Math.min(...bars.slice(i - (k + 1) * w + 1, i - k * w + 1).map((b) => b.l)));
  return (lows[1] > lows[2] ? 0.5 : 0) + (lows[0] > lows[1] ? 0.5 : 0);
}
export const FEATURE_NAMES = ['volumePersistence', 'trendAlignment', 'freshness', 'dipInUptrend', 'higherLows'] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
export function computeFeatures(p: DexPair, bars: Bar[], i: number): Record<FeatureName, number> {
  return { volumePersistence: volumePersistence(p), trendAlignment: trendAlignment(p), freshness: freshness(p), dipInUptrend: dipInUptrend(p), higherLows: higherLows(bars, i) };
}
