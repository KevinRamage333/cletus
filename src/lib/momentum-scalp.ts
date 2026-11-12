/**
 * Momentum scalp mode (owner request, Nov 11 2026). MOMENTUM_SCALP=off | dryrun | on.
 * Entry: last 5m buyers > sellers (buy txns share and buy-volume share >= SCALP_MIN_BUY_SHARE, default 0.6),
 * 5m volume rising vs the prior 5m candle, 5m volume >= SCALP_MIN_VOL_5M_USD (default $5k), on top of every
 * existing safety check and score floor. Exit plan: SL -8% (hard-bound minimum), +15% take selling 75% with a
 * tight 5% trail on the rest, time stop at 12 min if not >= +3%, plus the existing $1,500 volume and holder exits.
 *
 * Walk-forward replay (scripts/backtest/win-rate.ts, Nov 11) was negative out-of-sample (avg -2.06%/trade, n=33),
 * so it ships as dryrun only: `on` is treated as `dryrun` (logs what it would have done; never trades). Wiring the
 * scalp exit plan + time stop into live positions is deliberately left until a replay clears the bar.
 */
export type ScalpMode = 'off' | 'dryrun' | 'on';

export interface ScalpConfig { mode: ScalpMode; minBuyShare: number; minVol5mUsd: number; takeProfitPct: number; takeSellPct: number; trailPct: number; stopLossPct: number; timeStopMin: number; timeStopMinGainPct: number }

const num = (v: string | undefined, d: number, lo: number, hi: number) => { const x = Number(v); return v !== undefined && v.trim() !== '' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };

export function scalpConfig(env: Record<string, string | undefined> = process.env): ScalpConfig {
  const raw = (env.MOMENTUM_SCALP ?? 'off').trim().toLowerCase();
  // `on` is accepted but runs as dryrun (replay negative OOS; see header).
  const mode: ScalpMode = ['on', 'true', '1', 'dryrun', 'dry'].includes(raw) ? 'dryrun' : 'off';
  return {
    mode,
    minBuyShare: num(env.SCALP_MIN_BUY_SHARE, 0.6, 0.5, 0.9),
    minVol5mUsd: num(env.SCALP_MIN_VOL_5M_USD, 5000, 1500, 1_000_000),
    takeProfitPct: 15, takeSellPct: 75, trailPct: 5,
    stopLossPct: 8, // HARD_BOUNDS.minStopPct
    timeStopMin: 12, timeStopMinGainPct: 3,
  };
}

export interface ScalpInput {
  buys5m?: number | null; sells5m?: number | null;
  /** Ascending 5m candles (volume USD; open/close optional for the buy-volume proxy). */
  candles5m?: Array<{ volume: number; open?: number; close?: number; high?: number; low?: number }> | null;
  m5VolUsd?: number | null;
}

export interface ScalpCheck { pass: boolean; reasons: string[]; buyShare: number | null; volBuyShare: number | null; vol5m: number | null; prevVol5m: number | null }

/** Buy-volume share proxy from the last candle: close location in its range (no buy/sell USD split is published). */
function clv(c: { close?: number; high?: number; low?: number }): number | null {
  if (c.close == null || c.high == null || c.low == null) return null;
  const r = c.high - c.low;
  return r > 0 ? (c.close - c.low) / r : 0.5;
}

export function scalpEntryCheck(inp: ScalpInput, cfg: ScalpConfig): ScalpCheck {
  const reasons: string[] = [];
  const b = inp.buys5m ?? 0, s = inp.sells5m ?? 0;
  const buyShare = b + s > 0 ? b / (b + s) : null;
  const cs = (inp.candles5m ?? []).filter((c) => Number.isFinite(c.volume));
  const last = cs.length ? cs[cs.length - 1] : null;
  const prev = cs.length > 1 ? cs[cs.length - 2] : null;
  const vol5m = last ? last.volume : (typeof inp.m5VolUsd === 'number' ? inp.m5VolUsd : null);
  const prevVol5m = prev ? prev.volume : null;
  const volBuyShare = last ? clv(last) : null;
  if (buyShare == null) reasons.push('5m buy/sell txns unknown');
  else if (b <= s || buyShare < cfg.minBuyShare) reasons.push(`5m buy share ${(buyShare * 100).toFixed(0)}% < ${(cfg.minBuyShare * 100).toFixed(0)}%`);
  if (volBuyShare != null && volBuyShare < cfg.minBuyShare) reasons.push(`5m buy-volume share ~${(volBuyShare * 100).toFixed(0)}% < ${(cfg.minBuyShare * 100).toFixed(0)}%`);
  if (vol5m == null) reasons.push('5m volume unknown');
  else if (vol5m < cfg.minVol5mUsd) reasons.push(`5m volume $${Math.round(vol5m)} < $${cfg.minVol5mUsd}`);
  if (prevVol5m == null) reasons.push('prior 5m candle unknown');
  else if (vol5m != null && !(vol5m > prevVol5m)) reasons.push(`5m volume not rising ($${Math.round(vol5m)} <= $${Math.round(prevVol5m)})`);
  return { pass: reasons.length === 0, reasons, buyShare, volBuyShare, vol5m, prevVol5m };
}

/** Time stop: after timeStopMin minutes, sell unless up >= timeStopMinGainPct (and no partial taken). */
export function scalpTimeStop(openedAtMs: number, nowMs: number, gainPct: number, partialsTaken: number, cfg: ScalpConfig): boolean {
  return partialsTaken === 0 && nowMs - openedAtMs >= cfg.timeStopMin * 60_000 && gainPct < cfg.timeStopMinGainPct;
}

export function describeScalpPlan(cfg: ScalpConfig): string {
  return `SL -${cfg.stopLossPct}% | sell ${cfg.takeSellPct}% at +${cfg.takeProfitPct}%, ${cfg.trailPct}% trail on the rest | time stop ${cfg.timeStopMin}m if < +${cfg.timeStopMinGainPct}% | $1,500 5m-volume exit`;
}
