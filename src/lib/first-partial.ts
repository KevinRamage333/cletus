/**
 * Earlier first partial for the live adaptive exit plan (win-rate tuning). Moves the first take-profit
 * (and the break-even + trail arm that follow it) to a fixed +X% or X x the stop (R). Stops are untouched
 * and everything stays inside HARD_BOUNDS. Env: OWNER_FIRST_PARTIAL=pct:20 | r:1, OWNER_FIRST_PARTIAL_SELL_PCT=50.
 */
import { HARD_BOUNDS, type ExitBounds, type ExitPlan } from './adaptive-exits';

export interface FirstPartial { mode: 'pct' | 'r'; value: number; sellPct?: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export function firstPartialFromEnv(env: Record<string, string | undefined> = process.env): FirstPartial | null {
  const raw = (env.OWNER_FIRST_PARTIAL ?? '').trim().toLowerCase();
  if (!raw || raw === 'off' || raw === 'adaptive') return null;
  const m = /^(pct|r):([0-9.]+)$/.exec(raw);
  if (!m) return null;
  const value = Number(m[2]);
  if (!(value > 0)) return null;
  const sell = Number(env.OWNER_FIRST_PARTIAL_SELL_PCT);
  return { mode: m[1] as 'pct' | 'r', value, sellPct: Number.isFinite(sell) && sell > 0 ? sell : undefined };
}

/** Only ever moves the first partial EARLIER than the adaptive plan's own (never later). */
export function applyFirstPartial(plan: ExitPlan, fp: FirstPartial, b: ExitBounds = HARD_BOUNDS): ExitPlan {
  const want = fp.mode === 'r' ? fp.value * plan.stopLossPct : fp.value;
  const partial = round1(clamp(Math.min(want, plan.partialGainPct), b.minPartialPct, b.maxPartialPct));
  const sellPct = Math.round(clamp(fp.sellPct ?? plan.partialSellPct, b.minPartialSellPct, b.maxPartialSellPct));
  const final = round1(clamp(Math.max(plan.takeProfitPct, partial + 20), partial + 20, b.maxFinalPct));
  const label = fp.mode === 'r' ? `${fp.value}R` : `+${fp.value}%`;
  return {
    ...plan, partialGainPct: partial, partialSellPct: sellPct, breakEvenTriggerPct: partial, trailingArmPct: partial, takeProfitPct: final,
    notes: [...plan.notes, `first partial ${label} (win-rate tuning)`],
  };
}
