import { describe, it, expect } from 'vitest';
import { buildConfig, applyOwnerPlan } from '@/lib/config';
import { exitDecision, partialTakeProfit } from '@/lib/exits';

// Mirrors scripts/start-live-worker.sh
const env = {
  TRADING_MODE: 'live', TRADING_WALLET_PRIVATE_KEY: 'x', ALLOW_LIVE_IN_BETA: 'true', OWNER_PLAN_ENABLED: 'true', MCAP_PRESET: 'BALANCED',
  OWNER_STOP_LOSS_PCT: '20', OWNER_TAKE_PROFIT_PCT: '150', OWNER_TP_LADDER: '50:50', OWNER_BREAK_EVEN_TRIGGER_PCT: '50',
  OWNER_TRAILING_ARM_PCT: '50', OWNER_TRAILING_STOP_PCT: '8', ENABLE_TRAILING_STOP: 'false', STALE_POSITION_MINUTES: '120', STALE_BAND_PCT: '3',
  HOLD_TIME_MINUTES: '10080', OWNER_MAX_DAILY_LOSS_PCT: '25',
};
const c = applyOwnerPlan(buildConfig(env), true);
const now = new Date('2026-11-11T20:00:00Z');
const pos = (peak: number, ageMin = 30) => ({ entryPrice: 1, highestPrice: peak, openedAt: new Date(now.getTime() - ageMin * 60_000) });
const exit = (peak: number, price: number, ageMin = 30) => exitDecision(pos(peak, ageMin), price, c, now);

describe('live owner taper exits', () => {
  it('config: SL 20, partial 50% at +50, BE/trail armed at +50 with 8% trail, final TP 150, daily loss 25%', () => {
    expect(c).toMatchObject({ stopLossPct: 20, takeProfitPct: 150, breakEvenTriggerPct: 50, trailingArmPct: 50, trailingStopPct: 8, enableTrailingStop: true, maxDailyLossPct: 25 });
    expect(c.tpLadder).toEqual([{ gainPct: 50, sellPct: 50 }]);
  });
  it('before +50%: only the 20% stop (no 5% break-even, no early trail)', () => {
    expect(exit(1.3, 1.0)).toBeNull();          // was +30%, back to entry: still held
    expect(exit(1.3, 1.1)).toBeNull();          // 15% off a +30% peak: no trail yet
    expect(exit(1, 0.81)).toBeNull();
    expect(exit(1, 0.79)).toBe('stop_loss');
  });
  it('at +50% sells half; not again once taken', () => {
    expect(partialTakeProfit({ entryPrice: 1 }, 1.5, c.tpLadder, 0, c.takeProfitPct)).toEqual({ rung: 1, fraction: 0.5, gainPct: 50 });
    expect(partialTakeProfit({ entryPrice: 1 }, 1.49, c.tpLadder, 0, c.takeProfitPct)).toBeNull();
    expect(partialTakeProfit({ entryPrice: 1 }, 1.8, c.tpLadder, 1, c.takeProfitPct)).toBeNull();
    expect(exit(1.5, 1.5)).toBeNull();          // the partial, not a full exit
  });
  it('remainder: trails 8% from the peak, break-even stop, full exit at +150%', () => {
    expect(exit(1.8, 1.7)).toBeNull();          // -5.6% from peak
    expect(exit(1.8, 1.65)).toBe('trailing_stop'); // -8.3% from peak
    expect(exit(1.55, 1.0)).toBe('break_even');
    expect(exit(2.4, 2.5)).toBe('take_profit');
  });
  it('dead coin still frees the slot after 120 min inside ±3%', () => expect(exit(1.02, 1.01, 121)).toBe('stale_exit'));
  it('non-operator accounts keep the global exits', () => {
    const u = applyOwnerPlan(buildConfig(env), false);
    expect(u.tpLadder).not.toEqual([{ gainPct: 50, sellPct: 50 }]);
    expect(u.breakEvenTriggerPct).toBe(5);
  });
});
