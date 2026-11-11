import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  observeEquity, applyFlow, drawdownPct, withBotTx, botActiveSince, observeLive, recordFlow, loadState,
  markDrawdownPause, rebasePeak, describeLive, _resetForTests, type LiveEquityState,
} from '@/lib/live-drawdown';
import { ownerRecoverySize } from '@/lib/owner-plan';

const SOL = 150;
const lam = (usd: number) => Math.round((usd / SOL) * 1e9);
const T0 = 1_700_000_000_000;
const obs = (equityUsd: number, cashUsd: number, at: number) => ({ equityUsd, lamports: lam(cashUsd), solPriceUsd: SOL, at });

describe('live drawdown (pure)', () => {
  it('initialises the peak at the first equity seen, so it never pauses on start', () => {
    const r = observeEquity(null, obs(12.4, 6.8, T0), false);
    expect(r.initialised).toBe(true);
    expect(r.state.peakUsd).toBeCloseTo(12.4);
    expect(r.drawdownPct).toBe(0);
  });

  it('a deposit with no bot tx raises the peak by the same amount (not profit, no drawdown reset)', () => {
    let s = observeEquity(null, obs(10, 10, T0), false).state;
    s = observeEquity(s, obs(9, 9, T0 + 60_000), true).state; // a losing trade: 10% down
    expect(drawdownPct(s)).toBeCloseTo(10);
    const r = observeEquity(s, obs(12, 12, T0 + 120_000), false); // +$3 deposit
    expect(r.flowUsd).toBeCloseTo(3, 1);
    expect(r.state.netFlowsUsd).toBeCloseTo(3, 1);
    expect(r.state.peakUsd).toBeCloseTo(13, 1); // 10 + 3: the $1 loss is still there
    expect(r.drawdownPct).toBeCloseTo((1 / 13) * 100, 0);
    expect(r.state.flows.at(-1)?.kind).toBe('deposit');
  });

  it('a withdrawal with no bot tx lowers the peak instead of counting as a loss', () => {
    let s = observeEquity(null, obs(20, 20, T0), false).state;
    const r = observeEquity(s, obs(15, 15, T0 + 60_000), false);
    expect(r.flowUsd).toBeCloseTo(-5, 1);
    expect(r.drawdownPct).toBeCloseTo(0, 1);
    s = r.state;
    expect(s.peakUsd).toBeCloseTo(15, 1);
  });

  it('SOL changes while the bot transacted are trading P&L, not flows', () => {
    const s = observeEquity(null, obs(10, 10, T0), false).state;
    const r = observeEquity(s, obs(8.5, 8.5, T0 + 60_000), true);
    expect(r.flowUsd).toBe(0);
    expect(r.drawdownPct).toBeCloseTo(15);
    expect(r.settled).toBe(false);
  });

  it('never raises the peak from an unsettled (mid-trade) sample, e.g. a sell landed before the book closed it', () => {
    const s = observeEquity(null, obs(10, 4, T0), false).state;
    const r = observeEquity(s, obs(16, 10, T0 + 5_000), true); // proceeds + stale open position = double count
    expect(r.state.peakUsd).toBeCloseTo(10);
    const r2 = observeEquity(r.state, obs(10.2, 10, T0 + 65_000), false); // book caught up, same SOL
    expect(r2.flowUsd).toBe(0);
    expect(r2.state.peakUsd).toBeCloseTo(10.2);
  });

  it('SOL price moves are not flows (detection is in lamports)', () => {
    const s = observeEquity(null, { equityUsd: 10, lamports: lam(10), solPriceUsd: SOL, at: T0 }, false).state;
    const r = observeEquity(s, { equityUsd: 9, lamports: lam(10), solPriceUsd: SOL * 0.9, at: T0 + 60_000 }, false);
    expect(r.flowUsd).toBe(0);
    expect(r.drawdownPct).toBeCloseTo(10);
  });

  it('ignores dust below the threshold', () => {
    const s = observeEquity(null, obs(10, 10, T0), false).state;
    const r = observeEquity(s, { equityUsd: 10.01, lamports: s.lastLamports + 5_000, solPriceUsd: SOL, at: T0 + 60_000 }, false);
    expect(r.flowUsd).toBe(0);
  });

  it('applyFlow: a profit sweep moves the peak down with the payout', () => {
    const s: LiveEquityState = { ...observeEquity(null, obs(30, 30, T0), false).state };
    const after = applyFlow(s, -10, T0 + 1000, 'sweep');
    expect(after.peakUsd).toBeCloseTo(20);
    expect(after.netFlowsUsd).toBeCloseTo(-10);
    const r = observeEquity(after, obs(20, 20, T0 + 90_000), true); // bot was active: no double count
    expect(r.flowUsd).toBe(0);
    expect(r.drawdownPct).toBeCloseTo(0);
  });
});

describe('ownerRecoverySize', () => {
  it('recovery mode drops to the base tier', () => {
    expect(ownerRecoverySize([{ sizeUsd: 6 }, { sizeUsd: 8 }, { sizeUsd: 10 }])).toBe(6);
    expect(ownerRecoverySize([])).toBeNull();
  });
});

describe('live drawdown store + bot activity', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldd-'));
    process.env.LIVE_EQUITY_STORE = path.join(dir, 'live-equity.json');
    process.env.LIVE_FLOW_GRACE_MS = '30000';
    _resetForTests();
  });

  it('persists across a restart and detects a deposit made while the worker was down', () => {
    observeLive(obs(9, 9, T0));
    _resetForTests(); // new process
    expect(loadState()?.peakUsd).toBeCloseTo(9);
    const r = observeLive(obs(12, 12, T0 + 600_000));
    expect(r.flowUsd).toBeCloseTo(3, 1);
    expect(r.drawdownPct).toBeCloseTo(0, 1);
    expect(describeLive(loadState())).toMatch(/peak \$12\.00, net deposits \+\$3\.00, drawdown 0\.0%/);
  });

  it('withBotTx marks samples around a swap as bot activity', async () => {
    const now = Date.now();
    observeLive({ ...obs(10, 10, now) });
    expect(botActiveSince(now, now + 1)).toBe(false);
    let seenInside = false;
    await withBotTx(async () => { seenInside = botActiveSince(now); });
    expect(seenInside).toBe(true);
    expect(botActiveSince(now, Date.now() + 1)).toBe(true); // within grace after the swap
    const r = observeLive({ ...obs(6, 6, Date.now()) }); // SOL left in a buy: not a withdrawal
    expect(r.flowUsd).toBe(0);
    expect(r.settled).toBe(false);
  });

  it('recordFlow (sweep) and rebase after an owner resume', () => {
    observeLive(obs(30, 30, T0));
    recordFlow(-10, 'sweep', T0 + 1);
    expect(loadState()?.peakUsd).toBeCloseTo(20);
    markDrawdownPause(T0 + 2);
    expect(loadState()?.ddPausedAt).toBeTruthy();
    const s = rebasePeak(14, lam(14), T0 + 3);
    expect(s.peakUsd).toBe(14);
    expect(s.ddPausedAt).toBeNull();
    expect(observeLive(obs(14, 14, T0 + 60_000)).drawdownPct).toBe(0);
  });
});
