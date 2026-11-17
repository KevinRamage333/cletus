import { afterAll, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';

const fixture = vi.hoisted(() => ({ price: 1, accountId: '' }));
vi.mock('@/lib/jupiter', async (original) => ({
  ...(await original<typeof import('@/lib/jupiter')>()),
  jupPrices: async (mints: string[]) => Object.fromEntries(mints.map((mint) => [mint, fixture.price])),
}));
vi.mock('@/lib/dexscreener', async (original) => ({
  ...(await original<typeof import('@/lib/dexscreener')>()),
  discoverSolanaMints: async () => ['lifecycle-test-mint'],
  fetchSolPriceUsd: async () => 150,
  fetchPairsForMints: async () => new Map([['lifecycle-test-mint', {
    chainId: 'solana', dexId: 'raydium', pairAddress: 'fixture-pool',
    baseToken: { address: 'lifecycle-test-mint', symbol: 'FIXTURE', name: 'Fixture' },
    quoteToken: { address: 'fixture-sol', symbol: 'SOL' },
    priceUsd: String(fixture.price), marketCap: 1_000_000, pairCreatedAt: Date.now() - 48 * 3_600_000,
    liquidity: { usd: 250_000 }, volume: { m5: 20_000, h1: 100_000, h24: 500_000 },
    priceChange: { m5: 2, h1: 4, h6: 6, h24: 10 },
  }]]),
}));
vi.mock('@/lib/helius', async (original) => ({
  ...(await original<typeof import('@/lib/helius')>()),
  syncPoolSubscriptions: () => undefined,
}));
vi.mock('@/lib/sim-quote', async (original) => ({
  ...(await original<typeof import('@/lib/sim-quote')>()),
  simBuy: async ({ mid }: { mid: number }) => ({ fillPrice: mid * 1.01, feeBps: 0, source: 'model' }),
  simSell: async ({ mid }: { mid: number }) => ({ fillPrice: mid * 0.99, feeBps: 0, source: 'model' }),
  simFeesUsd: () => 1,
}));
vi.mock('@/lib/audit', async (original) => ({
  ...(await original<typeof import('@/lib/audit')>()),
  auditToken: async () => ({ passed: true, checks: [] }),
}));
vi.mock('@/lib/journal', () => ({ writeTradeReflection: async () => undefined }));
vi.mock('@/lib/profit-sweep', () => ({ maybeRunProfitSweep: async () => undefined }));
vi.mock('@/lib/app-api', () => ({
  appContext: async () => {
    const { prisma } = await import('@/lib/db');
    const { getConfig } = await import('@/lib/config');
    const a = await prisma.account.findUniqueOrThrow({ where: { id: fixture.accountId } });
    return { u: { email: 'paper-lifecycle@test.local' }, a, c: getConfig() };
  },
}));

const enabled = process.env.PAPER_SETTLEMENT_PG_TEST === '1';
afterAll(async () => { if (enabled) await prisma.$disconnect(); });

it.skipIf(!enabled)('runs a paper entry and exits through cron and reconciles the performance API after a fresh engine load', async () => {
  const env = {
    CRON_SECRET: 'ci-paper-lifecycle', CLETUS_ENGINE_TRANSPORT: 'cron', CLETUS_DEMO: 'false',
    ENGINE_DISABLED: 'false', TRADING_MODE: 'simulation', TRADING_PRESET: 'NONE',
    TAKE_PROFIT_PERCENTAGE: '25', PARTIAL_TAKE_PROFITS: '10:50',
    ENABLE_TRAILING_STOP: 'false', TRADE_JOURNAL: 'off',
    ENABLE_24_7_TRADING: 'true', ENABLE_PRESET_LAB: 'false', MIN_COMPOSITE_SCORE: '0.01',
    SEC_WASH_TRADE_WINDOW_MINUTES: '60', MAX_POSITION_SIZE_USD: '100',
    MCAP_PRESET: 'BALANCED', OWNER_PLAN_ENABLED: 'false',
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const a = await prisma.account.create({
    data: { name: 'Paper lifecycle fixture', isOperator: true, startingBalance: 10_000, cashUsd: 10_000, peakEquity: 10_000 },
  });
  fixture.accountId = a.id;
  try {
    const request = () => new Request('http://localhost/api/cron/paper-engine', {
      headers: { authorization: 'Bearer ci-paper-lifecycle' },
    });
    const tick = async () => {
      const { GET } = await import('@/app/api/cron/paper-engine/route');
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, skipped: false, monitoredAt: expect.any(String) });
    };

    fixture.price = 1;
    await tick();
    const entry = await prisma.position.findMany({ where: { accountId: a.id } });
    expect(entry).toHaveLength(1);
    const [p] = entry;
    expect(p).toMatchObject({ simulated: true, status: 'open', entryPrice: 1.01, feesUsd: 1 });
    expect(p.sizeUsd).toBeGreaterThan(0);
    const funded = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
    expect(funded.cashUsd).toBeCloseTo(a.startingBalance - p.sizeUsd - 1);
    fixture.price = 1.15;
    await tick();
    const partial = await prisma.position.findUniqueOrThrow({ where: { id: p.id } });
    expect(partial.status).toBe('open');
    expect(partial.partialsTaken).toBe(1);
    expect(partial.tokenAmount).toBeCloseTo(p.tokenAmount / 2);
    expect(partial.partialFeesUsd).toBe(1);

    vi.resetModules();
    await tick();
    const retried = await prisma.position.findUniqueOrThrow({ where: { id: p.id } });
    expect(retried.tokenAmount).toBeCloseTo(p.tokenAmount / 2);
    expect(retried.partialFeesUsd).toBe(1);

    fixture.price = 1.32;
    await tick();
    await tick();
    const closed = await prisma.position.findUniqueOrThrow({ where: { id: p.id } });
    const proceeds = (p.tokenAmount / 2) * (1.15 + 1.32) * 0.99;
    const pnl = proceeds - p.sizeUsd - 3;
    expect(await prisma.position.count({ where: { accountId: a.id } })).toBe(1);
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
    expect(report.account.cashUsd).toBeCloseTo(a.startingBalance + pnl);
    expect(report.account.equityUsd).toBeCloseTo(a.startingBalance + pnl);
    expect(report.account.realizedPnlUsd).toBeCloseTo(pnl);

    const { GET: exportTrades } = await import('@/app/api/protected/tax/export/route');
    const csv = await exportTrades();
    expect(csv.status).toBe(200);
    const [, header, trade] = (await csv.text()).trim().split('\n');
    expect(header).toContain('cost_basis_usd,proceeds_usd,fees_usd,realized_pnl_usd');
    const columns = trade.split(',');
    expect(columns.slice(0, 3)).toEqual(['paper', p.symbol, p.mint]);
    expect(columns.slice(5, 9)).toEqual([p.sizeUsd.toFixed(2), proceeds.toFixed(2), '3.00', pnl.toFixed(2)]);
  } finally {
    await prisma.account.delete({ where: { id: a.id } });
    vi.unstubAllEnvs();
  }
}, 30_000);
