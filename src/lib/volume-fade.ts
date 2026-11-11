/**
 * Volume-fade exit for live owner positions: if trading interest dries up for a sustained stretch while the
 * trade isn't working, sell to free the single position slot for the next coin.
 *
 * A sample is "faded" when the last-5-minute volume is below `volFrac` x the entry baseline (the average 5-min
 * volume over the hour before entry), or when sellers dominate (buy share of m5 txns < `maxBuyShare`, with at
 * least `minTxns` txns) while volume is also below `sellSideVolFrac` x baseline. The exit fires only after the
 * position has been faded continuously for `minutes`, has been held at least that long, and is between its
 * stop and its first profit target (a running winner is left to the taper/trail). Thresholds are hard-bounded.
 */
export interface FadeParams {
  volFrac: number;        // m5 volume below this share of baseline = faded
  minutes: number;        // continuous fade needed before exiting
  maxBuyShare: number;    // sell-dominance: buys / (buys + sells) below this
  sellSideVolFrac: number;// ...and volume below this share of baseline
  minTxns: number;        // ignore buy share on too few txns
  maxGainPct: number;     // don't fire at/above this unrealized gain (winner is running)
}
export const FADE_BOUNDS = { volFrac: [0.05, 0.5], minutes: [15, 30], maxBuyShare: [0.2, 0.45], sellSideVolFrac: [0.2, 1], minTxns: [4, 100], maxGainPct: [0, 100] } as const;
// Chosen by replay (scripts/backtest/volume-fade.ts, docs/BACKTEST.md): 15-min windows and looser volume cuts shook
// trades out of coins that were only pausing; 10% of entry volume for 20 min is the strictest 15-20 min setting.
export const DEFAULT_FADE: FadeParams = { volFrac: 0.1, minutes: 20, maxBuyShare: 0.2, sellSideVolFrac: 0.5, minTxns: 6, maxGainPct: 15 };

const clamp = (x: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, x));
export function boundedFade(p: Partial<FadeParams>): FadeParams {
  const m = { ...DEFAULT_FADE, ...Object.fromEntries(Object.entries(p).filter(([, v]) => Number.isFinite(v as number))) } as FadeParams;
  return {
    volFrac: clamp(m.volFrac, FADE_BOUNDS.volFrac), minutes: clamp(m.minutes, FADE_BOUNDS.minutes),
    maxBuyShare: clamp(m.maxBuyShare, FADE_BOUNDS.maxBuyShare), sellSideVolFrac: clamp(m.sellSideVolFrac, FADE_BOUNDS.sellSideVolFrac),
    minTxns: clamp(m.minTxns, FADE_BOUNDS.minTxns), maxGainPct: clamp(m.maxGainPct, FADE_BOUNDS.maxGainPct),
  };
}

export interface FlowSample { m5VolUsd: number; buys?: number; sells?: number }

/** Why this sample counts as faded (null = not faded). */
export function fadeReason(s: FlowSample, baselineM5Usd: number, p: FadeParams): string | null {
  if (!(baselineM5Usd > 0) || !Number.isFinite(s.m5VolUsd)) return null;
  const ratio = s.m5VolUsd / baselineM5Usd;
  if (ratio < p.volFrac) return `5m volume $${Math.round(s.m5VolUsd)} = ${(ratio * 100).toFixed(0)}% of entry level $${Math.round(baselineM5Usd)}`;
  const n = (s.buys ?? 0) + (s.sells ?? 0);
  if (n >= p.minTxns && ratio < p.sellSideVolFrac) {
    const share = (s.buys ?? 0) / n;
    if (share < p.maxBuyShare) return `sellers dominate (${s.buys}/${n} buys) on ${(ratio * 100).toFixed(0)}% of entry volume`;
  }
  return null;
}

export interface FadeState { since: number | null; reason: string | null }

/** Advance the fade clock with one sample; `fire` = exit now. */
export function stepFade(st: FadeState, reason: string | null, now: number, ctx: { openedAt: number; gainPct: number }, p: FadeParams): { st: FadeState; fire: boolean; heldFadedMin: number } {
  if (!reason) return { st: { since: null, reason: null }, fire: false, heldFadedMin: 0 };
  const since = st.since ?? now;
  const heldFadedMin = (now - since) / 60_000;
  const heldMin = (now - ctx.openedAt) / 60_000;
  const fire = heldFadedMin >= p.minutes && heldMin >= p.minutes && ctx.gainPct < p.maxGainPct;
  return { st: { since, reason }, fire, heldFadedMin };
}

/** Parse FADE_* env overrides (bounded). OWNER_VOLUME_FADE=off disables. */
export function fadeFromEnv(env: Record<string, string | undefined>): FadeParams | null {
  if ((env.OWNER_VOLUME_FADE ?? 'on').toLowerCase() === 'off') return null;
  const n = (k: string) => (env[k] !== undefined && env[k] !== '' ? Number(env[k]) : undefined);
  return boundedFade({ volFrac: n('FADE_VOL_FRAC'), minutes: n('FADE_MINUTES'), maxBuyShare: n('FADE_MAX_BUY_SHARE'), sellSideVolFrac: n('FADE_SELLSIDE_VOL_FRAC'), minTxns: n('FADE_MIN_TXNS'), maxGainPct: n('FADE_MAX_GAIN_PCT') } as Partial<FadeParams>);
}
