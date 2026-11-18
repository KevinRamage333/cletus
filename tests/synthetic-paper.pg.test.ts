import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { HttpError } from '@/lib/auth';
import { SYNTHETIC_MINT, SYNTHETIC_SYMBOL, syntheticPaperFill } from '@/lib/synthetic-paper';

const enabled = process.env.PAPER_SETTLEMENT_PG_TEST === '1';
const accountIds: string[] = [];
const ENV_KEYS = ['CLETUS_SYNTHETIC_PAPER', 'TRADING_MODE', 'VERCEL', 'VERCEL_ENV'] as const;
const priorEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;

async function openAccount(cashUsd: number) {
  const account = await prisma.account.create({
    data: { name: `synthetic-paper-${randomUUID()}`, startingBalance: cashUsd, cashUsd, peakEquity: cashUsd },
  });
  accountIds.push(account.id);
  return account;
}

beforeEach(() => {
  process.env.CLETUS_SYNTHETIC_PAPER = '1';
  process.env.TRADING_MODE = 'simulation';
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
});

afterEach(async () => {
  if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds.splice(0) } } });
  for (const key of ENV_KEYS) {
    const value = priorEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(async () => { if (enabled) await prisma.$disconnect(); });

it.skipIf(!enabled)('debits cash and opens one simulated position on a synthetic buy', async () => {
  const account = await openAccount(1000);
  const fill = await syntheticPaperFill(account, 'buy');
  expect(fill.side).toBe('buy');
  if (fill.side !== 'buy') return;
  const fresh = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
  const position = await prisma.position.findUniqueOrThrow({ where: { id: fill.id } });
  expect(fresh.cashUsd).toBeCloseTo(974.9, 6);
  expect(fresh.realizedPnl).toBe(0);
  expect(position).toMatchObject({
    status: 'open',
    simulated: true,
    symbol: SYNTHETIC_SYMBOL,
    mint: SYNTHETIC_MINT,
    network: 'solana',
    entryPrice: 1,
    sizeUsd: 25,
    tokenAmount: 25,
    feesUsd: 0.1,
  });
});

it.skipIf(!enabled)('rejects a synthetic buy the cash balance cannot cover and writes nothing', async () => {
  const account = await openAccount(25);
  await expect(syntheticPaperFill(account, 'buy')).rejects.toMatchObject({
    status: 400,
    message: 'Insufficient paper cash for this synthetic buy.',
  });
  const fresh = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
  expect(fresh.cashUsd).toBe(25);
  expect(await prisma.position.count({ where: { accountId: account.id } })).toBe(0);
});

it.skipIf(!enabled)('lets only one of two concurrent synthetic buys spend the last cash', async () => {
  const account = await openAccount(25 + 0.1);
  const results = await Promise.allSettled([syntheticPaperFill(account, 'buy'), syntheticPaperFill(account, 'buy')]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(HttpError);
  const fresh = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
  expect(fresh.cashUsd).toBeCloseTo(0, 6);
  expect(await prisma.position.count({ where: { accountId: account.id, status: 'open' } })).toBe(1);
});

it.skipIf(!enabled)('credits cash and realized P&L when the synthetic position is sold', async () => {
  const account = await openAccount(1000);
  await syntheticPaperFill(account, 'buy');
  const sold = await syntheticPaperFill(account, 'sell');
  expect(sold.side).toBe('sell');
  if (sold.side !== 'sell') return;
  expect(sold).toMatchObject({ ok: true, simulated: true, signed: false, broadcast: false, symbol: SYNTHETIC_SYMBOL });
  expect(sold.pnlUsd).toBeCloseTo(2.3, 6);
  const fresh = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
  const closed = await prisma.position.findFirstOrThrow({ where: { accountId: account.id } });
  expect(fresh.cashUsd).toBeCloseTo(1002.3, 6);
  expect(fresh.realizedPnl).toBeCloseTo(2.3, 6);
  expect(fresh.cashUsd - fresh.startingBalance).toBeCloseTo(fresh.realizedPnl, 6);
  expect(closed).toMatchObject({ status: 'closed', exitPrice: 1.1, exitReason: 'synthetic_paper' });
  expect(closed.pnlUsd).toBeCloseTo(2.3, 6);
  expect(closed.pnlPct).toBeCloseTo(9.2, 6);
  expect(closed.feesUsd).toBeCloseTo(0.2, 6);
  expect(await prisma.position.count({ where: { accountId: account.id, status: 'open' } })).toBe(0);
});
