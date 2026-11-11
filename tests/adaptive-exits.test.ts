import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeExitPlan, volatilityPctPerHour, regimeOf, regimeStats, learnFrom, planWithinBounds, planOverrides, describePlan, HARD_BOUNDS, MIN_LEARN_TRADES, type PastTrade } from '../src/lib/adaptive-exits';
import { exitDecision, partialTakeProfit } from '../src/lib/exits';
import { savePlanRecord, getPlanRecord, noteDrawdown, recordOutcome, pastTrades, _resetPlanStoreCache } from '../src/lib/exit-plan-store';

const neutral = regimeStats([1, -1, 2, -2, 0.5, -0.5, 1.5, -1.5]);

describe('volatility and regime', () => {
  it('defaults to 12%/h with no data and scales horizons by sqrt(time)', () => {
    expect(volatilityPctPerHour(null)).toBe(12);
    expect(volatilityPctPerHour({ h1: 10 })).toBeCloseTo(10);
    expect(volatilityPctPerHour({ h24: 24 })).toBeCloseTo(24 / Math.sqrt(24));
    expect(volatilityPctPerHour({ m5: -2, h1: 8 })).toBeGreaterThan(volatilityPctPerHour({ h1: 8 }) - 1);
  });
  it('classifies the band regime', () => {
    expect(regimeOf(regimeStats([-5, -4, -6, -3, -8, 1]))).toBe('risk_off');
    expect(regimeOf(regimeStats([5, 4, 6, 3, 8, -1]))).toBe('risk_on');
    expect(regimeOf(neutral)).toBe('neutral');
    expect(regimeOf(regimeStats([10, 10]))).toBe('neutral'); // too few coins to call it
  });
});

describe('computeExitPlan', () => {
  it('wider stop for a more volatile coin, always inside the hard bounds', () => {
    const calm = computeExitPlan({ priceChange: { m5: 0.5, h1: 4, h6: 8, h24: 15 }, composite: 0.65, liquidityUsd: 100_000, regime: neutral });
    const wild = computeExitPlan({ priceChange: { m5: 6, h1: 25, h6: 60, h24: 120 }, composite: 0.65, liquidityUsd: 100_000, regime: neutral });
    expect(wild.stopLossPct).toBeGreaterThan(calm.stopLossPct);
    for (const p of [calm, wild]) expect(planWithinBounds(p)).toBe(true);
  });
  it('clamps extreme inputs to the hard bounds', () => {
    const tiny = computeExitPlan({ priceChange: { m5: 0, h1: 0.1, h6: 0.1, h24: 0.1 }, composite: 0.6, liquidityUsd: 1e7, regime: neutral });
    const huge = computeExitPlan({ priceChange: { m5: 90, h1: 500, h6: 900, h24: 2000 }, composite: 0.99, liquidityUsd: 5_000, regime: neutral });
    expect(tiny.stopLossPct).toBe(HARD_BOUNDS.minStopPct);
    expect(huge.stopLossPct).toBe(HARD_BOUNDS.maxStopPct);
    expect(huge.takeProfitPct).toBeLessThanOrEqual(HARD_BOUNDS.maxFinalPct);
    expect(huge.trailingStopPct).toBeLessThanOrEqual(HARD_BOUNDS.maxTrailPct);
    expect(planWithinBounds(tiny) && planWithinBounds(huge)).toBe(true);
  });
  it('targets are R-multiples of the stop and the taper is ordered', () => {
    const p = computeExitPlan({ priceChange: { h1: 8 }, composite: 0.62, liquidityUsd: 80_000, regime: neutral });
    expect(p.partialGainPct).toBeCloseTo(2 * p.stopLossPct, 0);
    expect(p.takeProfitPct).toBeGreaterThan(p.partialGainPct);
    expect(p.breakEvenTriggerPct).toBe(p.partialGainPct);
    expect(p.trailingArmPct).toBe(p.partialGainPct);
  });
  it('risk-off tightens and banks more early; risk-on lets it run', () => {
    const pc = { h1: 10 };
    const off = computeExitPlan({ priceChange: pc, composite: 0.65, liquidityUsd: 100_000, regime: regimeStats([-5, -4, -6, -7, -8]) });
    const on = computeExitPlan({ priceChange: pc, composite: 0.65, liquidityUsd: 100_000, regime: regimeStats([5, 4, 6, 7, 8]) });
    expect(off.stopLossPct).toBeLessThan(on.stopLossPct);
    expect(off.partialSellPct).toBeGreaterThan(on.partialSellPct);
    expect(off.takeProfitPct).toBeLessThan(on.takeProfitPct);
  });
  it('a recomputed plan never stops out the open position on the spot', () => {
    const p = computeExitPlan({ priceChange: { h1: 3 }, composite: 0.66, liquidityUsd: 100_000, regime: neutral, currentPnlPct: -9 });
    expect(p.stopLossPct).toBeGreaterThanOrEqual(12);
    expect(exitDecision({ entryPrice: 1, highestPrice: 1, openedAt: new Date() }, 0.91, { ...planOverrides(p), holdTimeMinutes: 10080 })).toBeNull();
  });
  it('the plan drives the real exit rules: partial at +partial, then break-even, trail, final', () => {
    const p = computeExitPlan({ priceChange: { h1: 8 }, composite: 0.65, liquidityUsd: 100_000, regime: neutral });
    const o = { ...planOverrides(p), holdTimeMinutes: 10080 };
    const pos = { entryPrice: 1, highestPrice: 1, openedAt: new Date() };
    expect(exitDecision(pos, 1 - (p.stopLossPct + 0.1) / 100, o)).toBe('stop_loss');
    expect(partialTakeProfit(pos, 1 + p.partialGainPct / 100, o.tpLadder, 0, o.takeProfitPct)?.fraction).toBeCloseTo(p.partialSellPct / 100);
    const peak = 1 + (p.partialGainPct + 10) / 100;
    expect(exitDecision({ ...pos, highestPrice: peak }, peak * (1 - (p.trailingStopPct + 0.5) / 100), o)).toBe('trailing_stop');
    expect(exitDecision({ ...pos, highestPrice: peak }, 0.999, o)).toBe('break_even');
    expect(exitDecision(pos, 1 + p.takeProfitPct / 100, o)).toBe('take_profit');
    expect(describePlan(p)).toMatch(/SL -.*sell .*% at \+/);
  });
});

describe('learning loop', () => {
  const t = (mfe: number, mae: number, pnl: number, sl = 12): PastTrade => ({ mfePct: mfe, maePct: mae, pnlPct: pnl, stopLossPct: sl, won: pnl > 0 });
  it('does nothing below the minimum sample', () => {
    const l = learnFrom(Array.from({ length: MIN_LEARN_TRADES - 1 }, () => t(0, 12, -12)));
    expect(l.weight).toBe(0); expect(l.stopMult).toBe(1); expect(l.partialPct).toBeNull();
  });
  it('widens when winners dipped near their stop, tightens when losers never went green, both bounded', () => {
    const wide = learnFrom(Array.from({ length: 40 }, () => t(40, 11, 20)));
    const tight = learnFrom(Array.from({ length: 40 }, () => t(0.2, 12, -12)));
    expect(wide.stopMult).toBeGreaterThan(1); expect(wide.stopMult).toBeLessThanOrEqual(1.15);
    expect(tight.stopMult).toBeLessThan(1); expect(tight.stopMult).toBeGreaterThanOrEqual(0.85);
    expect(wide.weight).toBeLessThanOrEqual(0.5);
  });
  it('moves the partial target toward where past trades actually peaked, gradually', () => {
    const base = computeExitPlan({ priceChange: { h1: 8 }, composite: 0.65, liquidityUsd: 100_000, regime: neutral });
    const hist = Array.from({ length: 30 }, () => t(18, 4, 5, base.stopLossPct));
    const learned = computeExitPlan({ priceChange: { h1: 8 }, composite: 0.65, liquidityUsd: 100_000, regime: neutral, history: hist });
    expect(learned.partialGainPct).toBeLessThan(base.partialGainPct);
    expect(learned.partialGainPct).toBeGreaterThan(18);
    expect(learned.learnedFrom).toBe(30);
    expect(planWithinBounds(learned)).toBe(true);
  });
});

describe('exit plan store', () => {
  beforeEach(() => {
    process.env.EXIT_PLAN_STORE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plans-')), 'p.json');
    _resetPlanStoreCache();
  });
  it('persists plans, drawdown and outcomes, and feeds pastTrades', () => {
    const plan = computeExitPlan({ priceChange: { h1: 8 }, composite: 0.65, liquidityUsd: 1e5, regime: neutral });
    savePlanRecord({ positionId: 'a', mint: 'm', symbol: 'S', plan, source: 'entry', computedAt: new Date().toISOString(), maePct: 0 });
    noteDrawdown('a', 4.2); noteDrawdown('a', 3);
    recordOutcome('a', { mfePct: 12, pnlPct: 5, reason: 'trailing_stop' });
    _resetPlanStoreCache(); // reload from disk
    expect(getPlanRecord('a')?.plan.stopLossPct).toBe(plan.stopLossPct);
    expect(getPlanRecord('a')?.outcome?.maePct).toBeCloseTo(4.2);
    expect(pastTrades()).toEqual([{ mfePct: 12, maePct: 4.2, pnlPct: 5, stopLossPct: plan.stopLossPct, won: true }]);
  });
  it('excludes book write-offs from learning', () => {
    const plan = computeExitPlan({ priceChange: { h1: 8 }, composite: 0.65, liquidityUsd: 1e5, regime: neutral });
    savePlanRecord({ positionId: 'b', mint: 'm', symbol: 'S', plan, source: 'entry', computedAt: new Date().toISOString(), maePct: 0 });
    recordOutcome('b', { mfePct: 0, pnlPct: -100, reason: 'stuck_written_off' });
    expect(pastTrades()).toEqual([]);
  });
});

describe('OWNER_ADAPTIVE_EXITS flag', () => {
  it('is off unless explicitly on', async () => {
    const { parseOwnerPlanConfig } = await import('../src/lib/owner-plan');
    expect(parseOwnerPlanConfig({}).adaptiveExits).toBe(false);
    expect(parseOwnerPlanConfig({ OWNER_ADAPTIVE_EXITS: 'on' }).adaptiveExits).toBe(true);
    expect(parseOwnerPlanConfig({ OWNER_ADAPTIVE_EXITS: 'off' }).adaptiveExits).toBe(false);
  });
});
