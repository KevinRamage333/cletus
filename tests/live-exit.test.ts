import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  exitSlippageBps, recordSellFailure, shouldWriteOff, liveFillTokenAmount, safeExitPrice, isPriceStale, isNoRouteError, sellBackoffMs,
} from '@/lib/live-exit';

// ─── Mocks for the engine-level tests ──────────────────────────────────────
const h = vi.hoisted(() => ({
  positions: new Map<string, Record<string, unknown>>(),
  account: {} as Record<string, unknown>,
  state: {} as Record<string, unknown>,
  logs: [] as Array<{ level: string; msg: string }>,
  tokenBalanceRaw: vi.fn(),
  executeSwap: vi.fn(),
  mintDecimals: vi.fn(),
  getBalance: vi.fn(),
  aggregate: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/config', async (orig) => {
  const m = await orig<typeof import('@/lib/config')>();
  const cfg = m.buildConfig({ TRADING_MODE: 'live', TRADING_WALLET_PRIVATE_KEY: 'x', ALLOW_LIVE_IN_BETA: 'true', OWNER_PLAN_ENABLED: 'true', MCAP_PRESET: 'BALANCED', ENABLE_DYNAMIC_SIGNAL_WEIGHTING: 'false' });
  return { ...m, getConfig: () => cfg };
});
vi.mock('@/lib/logger', () => ({ log: vi.fn(async (level: string, msg: string) => { h.logs.push({ level, msg }); }) }));
vi.mock('@/lib/journal', () => ({ writeTradeReflection: vi.fn(), writeDailyJournals: vi.fn() }));
vi.mock('@/lib/profit-sweep', () => ({ maybeRunProfitSweep: vi.fn(async () => undefined) }));
vi.mock('@/lib/live-trade-log', () => ({ appendLiveTrade: vi.fn() }));
vi.mock('@/lib/wallet', () => ({ getOperatorPublicKey: () => '11111111111111111111111111111111', withKolWallet: <T>(fn: () => T) => fn(), activeWalletName: () => 'operator' }));
vi.mock('@/lib/executor', () => ({
  SOL_MINT: 'So11111111111111111111111111111111111111112',
  tokenBalanceRaw: h.tokenBalanceRaw, executeSwap: h.executeSwap, mintDecimals: h.mintDecimals,
  connection: () => ({ getBalance: h.getBalance }),
}));
vi.mock('@/lib/db', () => {
  const engineState = () => h.state;
  const db = {
      engineState: { upsert: vi.fn(async () => engineState()), update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(h.state, data)) },
      position: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => h.positions.get(where.id) ?? null),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(h.positions.get(where.id)!, data)),
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const row = h.positions.get(String(where.id));
          if (!row || !Object.entries(where).every(([key, value]) => row[key] === value)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
        findMany: h.findMany,
        aggregate: h.aggregate,
      },
      account: {
        findUniqueOrThrow: vi.fn(async () => h.account),
        findUnique: vi.fn(async () => h.account),
        update: vi.fn(async () => h.account),
      },
      signalWeight: { findMany: vi.fn(async () => []), upsert: vi.fn(), update: vi.fn() },
  };
  return { prisma: { ...db, $transaction: async <T>(run: (tx: typeof db) => Promise<T>) => run(db) } };
});

import { closePosition, entryBlockReason, resolveLiveFillAmount, mem } from '@/lib/engine';
import { buildConfig, applyOwnerPlan } from '@/lib/config';

const MINT = 'Mint1111111111111111111111111111111111111111';
function livePosition(over: Record<string, unknown> = {}) {
  return { id: 'p1', accountId: 'op', mint: MINT, symbol: 'RUG', status: 'open', simulated: false, entryPrice: 0.001, sizeUsd: 6, tokenAmount: 6000, feesUsd: 0.02, partialPnlUsd: 0, partialCostUsd: 0, partialsTaken: 0, signals: '{}', lastPrice: 0.001, highestPrice: 0.001, openedAt: new Date(), ...over };
}

beforeEach(() => {
  h.positions.clear();
  h.logs.length = 0;
  h.account = { id: 'op', isOperator: true, paused: false, consecutiveLosses: 0, consecutiveWins: 0, cashUsd: 9725, peakEquity: 10000, recoveryMode: false, labPreset: null, settings: null };
  h.state = { id: 'global', priorityFeeLamports: 100000, slippageBps: 500, consecutiveFailures: 0, pausedUntil: null, killSwitch: false, lastError: null };
  h.tokenBalanceRaw.mockReset(); h.executeSwap.mockReset(); h.mintDecimals.mockReset(); h.getBalance.mockReset(); h.aggregate.mockReset(); h.findMany.mockReset();
  h.findMany.mockResolvedValue([]);
  mem.sellFailures.clear();
  mem.solPrice = 160;
  process.env.LIVE_ZERO_RECHECK_MS = '0';
  process.env.LIVE_FILL_READ_DELAY_MS = '0';
  process.env.RECLAIM_TOKEN_RENT = 'off';
});

describe('live-exit helpers', () => {
  it('protective exits climb the slippage ladder; take-profit starts at base', () => {
    expect([0, 1, 2, 3, 9].map((n) => exitSlippageBps('stop_loss', n, 100))).toEqual([300, 800, 1500, 1500, 1500]);
    expect(exitSlippageBps('kill_switch', 0, 500)).toBe(500);
    expect(exitSlippageBps('take_profit', 0, 500)).toBe(500);
    expect(exitSlippageBps('take_profit', 2, 500)).toBe(1500);
    expect(exitSlippageBps('stop_loss', 9, 100, [300, 800, 1500, 3000])).toBe(1500);
    expect(exitSlippageBps('stop_loss', 0, 5000)).toBe(1500);
  });
  it('failure counter backs off and writes off after N (sooner for no-route)', () => {
    let s = recordSellFailure(undefined, 'jupiter /order: No route found', 0);
    expect(s).toMatchObject({ failures: 1, noRouteFailures: 1, nextAttemptAt: 5000 });
    expect(sellBackoffMs(10)).toBe(60_000);
    for (let i = 0; i < 3; i++) s = recordSellFailure(s, 'could not find any route', 0);
    expect(shouldWriteOff(s, 8, 4)).toBe(true);
    let t = recordSellFailure(undefined, 'timeout', 0);
    for (let i = 0; i < 6; i++) t = recordSellFailure(t, 'timeout', 0);
    expect(shouldWriteOff(t, 8, 4)).toBe(false);
    t = recordSellFailure(t, 'timeout', 0);
    expect(shouldWriteOff(t, 8, 4)).toBe(true);
    expect(isNoRouteError('TOKEN_NOT_TRADABLE')).toBe(true);
  });
  it('fill amount uses outAmount+decimals, else balance, never 0', () => {
    expect(liveFillTokenAmount('6000000000', 6, null)).toBe(6000);
    expect(liveFillTokenAmount('0', 6, 5_000_000n)).toBe(5);
    expect(liveFillTokenAmount(undefined, 6, 0n)).toBeNull();
    expect(liveFillTokenAmount('123', null, null)).toBeNull();
    expect(safeExitPrice(5, 0, 0.0009)).toBe(0.0009);
    expect(safeExitPrice(6, 6000, 1)).toBeCloseTo(0.001);
  });
  it('price staleness', () => {
    expect(isPriceStale(0, 120_001, 120_000)).toBe(true);
    expect(isPriceStale(0, 60_000, 120_000)).toBe(false);
    expect(isPriceStale(undefined, 1e12, 120_000)).toBe(false);
  });
});

describe('live exit reconciliation', () => {
  it('zero on-chain balance leaves the position open for reconciliation', async () => {
    h.positions.set('p1', livePosition());
    h.tokenBalanceRaw.mockResolvedValue({ raw: 0n, decimals: 6 });
    await closePosition('p1', 0.001, 'stop_loss');
    expect(h.tokenBalanceRaw).toHaveBeenCalledTimes(2);
    expect(h.executeSwap).not.toHaveBeenCalled();
    expect(h.positions.get('p1')).toMatchObject({ status: 'open' });
  });

  it('a one-off zero read that recovers still sells normally', async () => {
    h.positions.set('p1', livePosition());
    h.tokenBalanceRaw.mockResolvedValueOnce({ raw: 0n, decimals: 6 }).mockResolvedValue({ raw: 7_000_000_000n, decimals: 6 });
    h.executeSwap.mockResolvedValue({ signature: 'sig', inAmount: '6000000000', outAmount: String(0.03 * 1e9) });
    await closePosition('p1', 0.001, 'take_profit');
    expect(h.executeSwap.mock.calls[0]?.[1]).toMatchObject({ amountRaw: 6_000_000_000n });
    expect(h.positions.get('p1')).toMatchObject({ status: 'closed', exitReason: 'take_profit', exitTx: 'sig' });
    expect(h.positions.get('p1')!.exitPrice).toBeCloseTo((0.03 * 160) / 6000, 8);
  });

  it('stop-loss retries back off and retain unfilled positions', async () => {
    h.positions.set('p1', livePosition());
    h.tokenBalanceRaw.mockResolvedValue({ raw: 6_000_000_000n, decimals: 6 });
    h.executeSwap.mockRejectedValue(new Error('jupiter /order: No route found'));
    const slips: number[] = [];
    h.executeSwap.mockImplementation(async (_c: unknown, r: { slippageBps: number }) => { slips.push(r.slippageBps); throw new Error('jupiter /order: No route found'); });
    for (let i = 0; i < 4; i++) {
      const s = mem.sellFailures.get('p1');
      if (s) mem.sellFailures.set('p1', { ...s, nextAttemptAt: 0 }); // skip the backoff wait
      await closePosition('p1', 0.0009, 'stop_loss');
    }
    expect(slips).toEqual([500, 800, 1500, 1500]);
    expect(h.positions.get('p1')).toMatchObject({ status: 'open' });
    expect(h.logs.some((l) => l.level === 'warn' && l.msg.includes('remains open for reconciliation'))).toBe(true);
    expect(mem.sellFailures.has('p1')).toBe(true);
    // Sell failures don't bump the global self-heal counter, so they can't pause scanning.
    expect(h.state.consecutiveFailures).toBe(0);
  });

  it('respects the backoff between failed attempts', async () => {
    h.positions.set('p1', livePosition());
    h.tokenBalanceRaw.mockResolvedValue({ raw: 6_000_000_000n, decimals: 6 });
    h.executeSwap.mockRejectedValue(new Error('timeout'));
    await closePosition('p1', 0.0009, 'stop_loss');
    await closePosition('p1', 0.0009, 'stop_loss');
    expect(h.executeSwap).toHaveBeenCalledTimes(1);
    expect(h.positions.get('p1')!.status).toBe('open');
  });
});

describe('item 2: live buy fill amount', () => {
  const c = applyOwnerPlan(buildConfig({ TRADING_MODE: 'live', TRADING_WALLET_PRIVATE_KEY: 'x', ALLOW_LIVE_IN_BETA: 'true', OWNER_PLAN_ENABLED: 'true' }), true);
  it('uses the swap outAmount with mint decimals (no balance read needed)', async () => {
    h.mintDecimals.mockResolvedValue(9);
    expect(await resolveLiveFillAmount(c, MINT, '2500000000000')).toBe(2500);
    expect(h.tokenBalanceRaw).not.toHaveBeenCalled();
  });
  it('falls back to retried balance reads when outAmount is missing; never returns 0', async () => {
    h.mintDecimals.mockResolvedValue(null);
    h.tokenBalanceRaw.mockResolvedValueOnce({ raw: 0n, decimals: 6 }).mockRejectedValueOnce(new Error('rpc')).mockResolvedValue({ raw: 7_000_000n, decimals: 6 });
    expect(await resolveLiveFillAmount(c, MINT, undefined)).toBe(7);
    h.tokenBalanceRaw.mockReset(); h.tokenBalanceRaw.mockResolvedValue({ raw: 0n, decimals: 6 });
    expect(await resolveLiveFillAmount(c, MINT, '0')).toBeNull();
  });
});

describe('item 3: live loss limits use the on-chain wallet and live trades only', () => {
  const c = applyOwnerPlan(buildConfig({ TRADING_MODE: 'live', TRADING_WALLET_PRIVATE_KEY: 'x', ALLOW_LIVE_IN_BETA: 'true', OWNER_PLAN_ENABLED: 'true' }), true);
  const lamports = (usd: number) => Math.round((usd / 160) * 1e9);

  it('owner daily stop is 15% of on-chain equity: -$1 passes, -$1.80 trips (paper $9,725 never would)', async () => {
    expect(c.maxDailyLossPct).toBe(15);
    h.aggregate.mockResolvedValue({ _sum: { pnlUsd: -1 } });
    expect(await entryBlockReason(h.account as never, c, { getLamports: async () => lamports(9.87) })).toBeNull();
    h.aggregate.mockReset();
    h.aggregate.mockResolvedValue({ _sum: { pnlUsd: -1.8 } });
    const r = await entryBlockReason(h.account as never, c, { getLamports: async () => lamports(9.87) });
    expect(r).toMatch(/max daily loss/);
    const where = h.aggregate.mock.calls[0][0].where;
    expect(where.simulated).toBe(false);
  });

  it('loss streak counts only live trades, not the paper history on the account', async () => {
    h.aggregate.mockResolvedValue({ _sum: { pnlUsd: 0 } });
    const acct = { ...h.account, consecutiveLosses: 9 }; // paper streak
    h.findMany.mockImplementation(async ({ where }: { where: { status: string } }) => (where.status === 'closed' ? [{ pnlUsd: -0.3 }, { pnlUsd: 0.5 }, { pnlUsd: -1 }] : []));
    expect(await entryBlockReason(acct as never, c, { getLamports: async () => lamports(9.87) })).toBeNull();
    h.findMany.mockImplementation(async ({ where }: { where: { status: string } }) => (where.status === 'closed' ? [{ pnlUsd: -0.3 }, { pnlUsd: -0.2 }, { pnlUsd: -0.1 }, { pnlUsd: -0.4 }] : []));
    expect(await entryBlockReason(acct as never, c, { getLamports: async () => lamports(9.87) })).toMatch(/4 losses in a row/);
  });

  it('allows entries when live P&L is flat', async () => {
    h.aggregate.mockResolvedValue({ _sum: { pnlUsd: 0 } });
    expect(await entryBlockReason(h.account as never, c, { getLamports: async () => lamports(9.87) })).toBeNull();
  });

  it('blocks when the on-chain balance cannot be read', async () => {
    h.aggregate.mockResolvedValue({ _sum: { pnlUsd: 0 } });
    expect(await entryBlockReason(h.account as never, c, { getLamports: async () => { throw new Error('rpc down'); } })).toMatch(/on-chain wallet balance unavailable/);
  });

  it('paper accounts still use the book', async () => {
    h.aggregate.mockResolvedValue({ _sum: { pnlUsd: -1 } });
    const sim = buildConfig({});
    expect(await entryBlockReason({ ...h.account, isOperator: false } as never, sim)).toBeNull();
    expect(h.aggregate.mock.calls[0][0].where.simulated).toBeUndefined();
  });
});

describe('improvement pass: sell lock and on-chain equity in the live trade log', () => {
  it('two paths closing the same live position at once sell only once', async () => {
    h.positions.set('p1', livePosition());
    h.tokenBalanceRaw.mockResolvedValue({ raw: 6_000_000_000n, decimals: 6 });
    let release!: () => void;
    h.executeSwap.mockImplementation(() => new Promise((r) => { release = () => r({ signature: 'sig', inAmount: '6000000000', outAmount: String(0.03 * 1e9) }); }));
    const a = closePosition('p1', 0.0009, 'stop_loss');
    const b = closePosition('p1', 0.0009, 'stop_loss'); // e.g. WebSocket fast path racing the monitor
    await b;
    await vi.waitFor(() => expect(h.executeSwap).toHaveBeenCalledTimes(1));
    release(); await a;
    expect(h.executeSwap).toHaveBeenCalledTimes(1);
    expect(mem.selling.has('p1')).toBe(false);
  });

  it('a live close logs the on-chain wallet equity, not the ~$9.7k paper book', async () => {
    const { appendLiveTrade } = await import('@/lib/live-trade-log');
    (appendLiveTrade as unknown as ReturnType<typeof vi.fn>).mockClear();
    h.positions.set('p1', livePosition());
    h.tokenBalanceRaw.mockResolvedValue({ raw: 6_000_000_000n, decimals: 6 });
    h.executeSwap.mockResolvedValue({ signature: 'sig', inAmount: '6000000000', outAmount: String(0.03 * 1e9) });
    h.getBalance.mockResolvedValue(0.06 * 1e9); // 0.06 SOL x $160 = $9.60
    h.findMany.mockResolvedValue([]);
    await closePosition('p1', 0.001, 'take_profit');
    const call = (appendLiveTrade as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as { equityUsd: number | null };
    expect(call.equityUsd).toBeCloseTo(9.6, 2);
  });

  it('logs null equity (not the book) when the wallet cannot be read', async () => {
    const { liveEquityForLog } = await import('@/lib/engine');
    const { getConfig } = await import('@/lib/config');
    expect(await liveEquityForLog(getConfig(), 'op', async () => { throw new Error('rpc timeout'); })).toBeNull();
    expect(await liveEquityForLog(getConfig(), 'op', async () => 0.05 * 1e9)).toBeCloseTo(8, 2);
  });
});
