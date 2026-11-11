import { describe, it, expect } from 'vitest';
import { onFailure, onSuccess, isPaused } from '@/lib/healer';
import { exitDecision } from '@/lib/exits';
import { buildConfig, isWithinSchedule } from '@/lib/config';
import { redactSecrets } from '@/lib/redact';
import { mockAnswer } from '@/lib/brain';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

describe('self-healing', () => {
  const P = { basePriorityFee: 100000, baseSlippageBps: 500, escalation: 1.5, maxPriorityFee: 400000, widenStepBps: 100, maxSlippageBps: 800, maxConsecutiveFailures: 3, pauseMinutes: 15 };
  const s0 = { priorityFeeLamports: 100000, slippageBps: 500, consecutiveFailures: 0, pausedUntil: null };
  it('raises priority fee on dropped tx, widens slippage on slippage errors, both capped', () => {
    expect(onFailure(s0, 'tx_dropped', P).priorityFeeLamports).toBe(150000);
    expect(onFailure(s0, 'slippage', P).slippageBps).toBe(600);
    let s = s0;
    for (let i = 0; i < 10; i++) s = onFailure(s, 'other', P);
    expect(s.priorityFeeLamports).toBe(400000);
    expect(s.slippageBps).toBe(800);
  });
  it('pauses after repeated failures and recovers on success', () => {
    const now = new Date();
    let s = s0;
    for (let i = 0; i < 3; i++) s = onFailure(s, 'rpc', P, now);
    expect(isPaused(s, now)).toBe(true);
    const ok = onSuccess(s, P);
    expect(ok.consecutiveFailures).toBe(0);
    expect(isPaused(ok)).toBe(false);
    expect(ok.priorityFeeLamports).toBeLessThan(s.priorityFeeLamports);
  });
});

describe('exits', () => {
  const p = { stopLossPct: 10, takeProfitPct: 25, breakEvenTriggerPct: 5, enableTrailingStop: true, trailingStopPct: 5, holdTimeMinutes: 60 };
  const pos = { entryPrice: 1, highestPrice: 1, openedAt: new Date() };
  it('stop loss, take profit, trailing, break-even, time', () => {
    expect(exitDecision(pos, 0.89, p)).toBe('stop_loss');
    expect(exitDecision(pos, 1.3, p)).toBe('take_profit');
    expect(exitDecision({ ...pos, highestPrice: 1.2 }, 1.13, p)).toBe('trailing_stop');
    expect(exitDecision({ ...pos, highestPrice: 1.06 }, 0.999, p)).toBe('break_even');
    expect(exitDecision({ ...pos, openedAt: new Date(Date.now() - 61 * 60_000) }, 1.01, p)).toBe('time_exit');
    expect(exitDecision(pos, 1.02, p)).toBeNull();
  });
});

describe('config & presets', () => {
  it('defaults to simulation; fixed defaults from the guide', () => {
    const c = buildConfig({});
    expect(c.mode).toBe('simulation');
    expect(c.minVolume24hUsd).toBe(10000);
    expect(c.minMarketCap).toBe(10000);
    expect(c.maxMarketCap).toBe(500000);
    expect(c.geminiModel).toBe('gemini-2.5-flash');
    expect(c.tiers[4].multiplier).toBe(3.0);
  });
  it('live requires a wallet key; live defaults to CONSERVATIVE_EARNER', () => {
    expect(buildConfig({ TRADING_MODE: 'live' }).mode).toBe('simulation');
    const live = buildConfig({ TRADING_MODE: 'live', TRADING_WALLET_PRIVATE_KEY: 'x', BETA_MODE: 'false' });
    expect(live.mode).toBe('live');
    expect(live.preset).toBe('CONSERVATIVE_EARNER');
    expect(live.aggression).toBe('CONSERVATIVE');
    expect(live.maxPositionSizeUsd).toBe(1000);
    expect(live.stopLossPct).toBe(5);
    expect(buildConfig({ TRADING_MODE: 'live', TRADING_WALLET_PRIVATE_KEY: 'x', BETA_MODE: 'true' }).mode).toBe('simulation');
  });
  it('all 5 presets resolve and explicit env overrides win', () => {
    for (const p of ['CONSERVATIVE_EARNER', 'DAY_TRADER', 'NIGHT_TRADER', 'ALPHA_HUNTER_24_7', 'WEEKEND_WARRIOR']) expect(buildConfig({ TRADING_PRESET: p }).preset).toBe(p);
    expect(buildConfig({ TRADING_PRESET: 'ALPHA_HUNTER_24_7' }).aggression).toBe('MAXIMUM');
    expect(buildConfig({ TRADING_PRESET: 'DAY_TRADER', MAX_OPEN_POSITIONS: '3' }).maxOpenPositions).toBe(3);
    expect(buildConfig({ GEMINI_MODEL: 'gemini-2.5-pro' }).geminiModel).toBe('gemini-2.5-pro');
  });
  it('schedule handles weekdays and overnight windows', () => {
    const c = { enable247: false, startTime: '09:00', endTime: '17:00', tradingDays: [0, 1, 2, 3, 4], timezone: 'UTC', pauseOnWeekends: true };
    expect(isWithinSchedule(c, new Date('2026-11-11T12:00:00Z'))).toBe(true); // Wed
    expect(isWithinSchedule(c, new Date('2026-11-11T20:00:00Z'))).toBe(false);
    expect(isWithinSchedule(c, new Date('2026-11-14T12:00:00Z'))).toBe(false); // Sat
    expect(isWithinSchedule({ ...c, startTime: '21:00', endTime: '05:00' }, new Date('2026-11-11T23:00:00Z'))).toBe(true);
  });
});

describe('secret hygiene & brain fallback', () => {
  it('redacts secret keys in any format', () => {
    const kp = Keypair.generate();
    const b58 = bs58.encode(kp.secretKey);
    expect(redactSecrets(`key=${b58}`)).not.toContain(b58);
    expect(redactSecrets(JSON.stringify(Array.from(kp.secretKey)))).toBe('[REDACTED]');
    expect(redactSecrets(kp.publicKey.toBase58())).toBe(kp.publicKey.toBase58());
  });
  it('mock brain answers without a Gemini key', () => {
    const ctx = { mode: 'simulation', preset: 'NONE', aggression: 'MODERATE', killSwitch: false, equity: 10000, cash: 9000, realizedPnl: 12, unrealizedPnl: -3, winRate: 0.5, closedTrades: 2, openPositions: [], weights: { momentum: 0.2 }, topCandidates: [], lastScan: 'x' };
    expect(mockAnswer('what is my pnl?', ctx)).toMatch(/Realized PnL \$12\.00/);
    expect(mockAnswer('kill switch?', ctx)).toMatch(/kill switch/i);
  });
});
