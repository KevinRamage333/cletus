import { afterAll, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';

const fixture = vi.hoisted(() => ({ price: 1, accountId: '' }));
vi.mock('@/lib/jupiter', async (original) => ({
  ...(await original<typeof import('@/lib/jupiter')>()),
  jupPrices: async (mints: string[]) => Object.fromEntries(mints.map((mint) => [mint, fixture.price])),
}));
vi.mock('@/lib/dexscreener', async (original) => ({
  ...(await original<typeof import('@/lib/dexscreener')>()),
  fetchPairsForMints: async () => new Map(),
}));
vi.mock('@/lib/helius', async (original) => ({
  ...(await original<typeof import('@/lib/helius')>()),
  syncPoolSubscriptions: () => undefined,
}));
vi.mock('@/lib/sim-quote', async (original) => ({
  ...(await original<typeof import('@/lib/sim-quote')>()),
  simSell: async ({ mid }: { mid: number }) => ({ fillPrice: mid * 0.99, feeBps: 0, source: 'model' }),
  simFeesUsd: () => 1,
}));
vi.mock('@/lib/engine', async (original) => ({
  ...(await original<typeof import('@/lib/engine')>()),
  scanTick: async () => 'fixture scan',
}));
vi.mock('@/lib/journal', () => ({ writeTradeReflection: async () => undefined }));
vi.mock('@/lib/profit-sweep', () => ({ maybeRunProfitSweep: async () => undefined }));
vi.mock('@/lib/app-api', () => ({
  appContext: async () => {
    const { prisma } = await import('@/lib/db');
    const { getConfig } = await import('@/lib/config');
    const a = await prisma.account.findUniqueOrThrow({ where: { id: fixture.accountId } });
    return { a, c: getConfig() };
  },
}));

const enabled = process.env.PAPER_SETTLEMENT_PG_TEST === '1';
afterAll(async () => { if (enabled) await prisma.$disconnect(); });

it.skipIf(!enabled)('runs real paper exits through cron and reconciles the performance API after a fresh engine load', async () => {
  const env = {
    CRON_SECRET: 'ci-paper-lifecycle', CLETUS_ENGINE_TRANSPORT: 'cron', CLETUS_DEMO: 'false',
    ENGINE_DISABLED: 'false', TRADING_MODE: 'simulation', TRADING_PRESET: 'NONE',
    TAKE_PROFIT_PERCENTAGE: '25', PARTIAL_TAKE_PROFITS: '10:50',
    ENABLE_TRAILING_STOP: 'false', TRADE_JOURNAL: 'off',
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const a = await prisma.account.create({
    data: { name: 'Paper lifecycle fixture', startingBalance: 1000, cashUsd: 899, peakEquity: 1000 },
  });
  fixture.accountId = a.id;
  try {
    // Seed an already-filled entry with its entry fee debited from cash.
    const p = await prisma.position.create({
      data: {
        accountId: a.id, mint: 'lifecycle-test-mint', symbol: 'FIXTURE',
        entryPrice: 1, highestPrice: 1, lastPrice: 1, tokenAmount: 100, sizeUsd: 100,
        feesUsd: 1, compositeScore: 0.8, signals: '{}',
      },
    });
    const request = () => new Request('http://localhost/api/cron/paper-engine', {
      headers: { authorization: 'Bearer ci-paper-lifecycle' },
    });
    const tick = async () => {
      const { GET } = await import('@/app/api/cron/paper-engine/route');
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, skipped: false, monitoredAt: expect.any(String) });
    };

    fixture.price = 1.12;
    await tick();
    const partial = await prisma.position.findUniqueOrThrow({ where: { id: p.id } });
    expect(partial.status).toBe('open');
    expect(partial.partialsTaken).toBe(1);
    expect(partial.tokenAmount).toBe(50);
    expect(partial.partialFeesUsd).toBe(1);

    vi.resetModules();
    await tick();
    const retried = await prisma.position.findUniqueOrThrow({ where: { id: p.id } });
    expect(retried.tokenAmount).toBe(50);
    expect(retried.partialFeesUsd).toBe(1);

    fixture.price = 1.30;
    await tick();
    await tick();
    const closed = await prisma.position.findUniqueOrThrow({ where: { id: p.id } });
    const pnl = 50 * 1.12 * 0.99 + 50 * 1.30 * 0.99 - 100 - 3;
    expect(closed.status).toBe('closed');
    expect(closed.exitReason).toBe('take_profit');
    expect(closed.feesUsd).toBe(3);
    expect(closed.pnlUsd).toBeCloseTo(pnl);
    const { GET } = await import('@/app/api/protected/performance/route');
    const response = await GET();
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.coverage.closedTradesAvailable).toBe(1);
    expect(report.openPositions).toHaveLength(0);
    expect(report.recentTrades[0]).toMatchObject({ id: p.id, feesUsd: 3, simulated: true });
    expect(report.recentTrades[0].pnlUsd).toBeCloseTo(pnl);
    expect(report.account.cashUsd).toBeCloseTo(1000 + pnl);
    expect(report.account.equityUsd).toBeCloseTo(1000 + pnl);
    expect(report.account.realizedPnlUsd).toBeCloseTo(pnl);
  } finally {
    await prisma.account.delete({ where: { id: a.id } });
    vi.unstubAllEnvs();
  }
}, 30_000);
