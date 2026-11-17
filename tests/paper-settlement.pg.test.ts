import { randomUUID } from 'node:crypto';
import { afterEach, afterAll, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { settlePaperExit, settlePositionExit } from '@/lib/paper-settlement';

const accountIds: string[] = [];
const enabled = process.env.PAPER_SETTLEMENT_PG_TEST === '1';

async function openPosition(simulated = true) {
  const account = await prisma.account.create({
    data: { name: `paper-settlement-${randomUUID()}`, startingBalance: 1000, cashUsd: 899, peakEquity: 1000 },
  });
  accountIds.push(account.id);
  return prisma.position.create({
    data: {
      accountId: account.id, mint: 'test-mint', symbol: 'TEST', simulated,
      entryPrice: 1, highestPrice: 1, lastPrice: 1, tokenAmount: 100, sizeUsd: 100,
      feesUsd: 1, compositeScore: 0.8, signals: '{}',
    },
  });
}

afterEach(async () => {
  if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds.splice(0) } } });
});
afterAll(async () => { if (enabled) await prisma.$disconnect(); });

it.skipIf(!enabled)('credits only one of two simultaneous paper closes', async () => {
  const p = await openPosition();
  const close = () => settlePaperExit(p, { status: 'closed', pnlUsd: 18, feesUsd: 2 }, {
    cashUsd: { increment: 119 }, realizedPnl: { increment: 18 }, consecutiveWins: { increment: 1 },
  });
  const results = await Promise.all([close(), close()]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const a = await prisma.account.findUniqueOrThrow({ where: { id: p.accountId } });
  const closed = await prisma.position.findUniqueOrThrow({ where: { id: p.id } });
  expect(closed.status).toBe('closed');
  expect(closed.feesUsd).toBe(2);
  expect(a.realizedPnl).toBe(closed.pnlUsd);
  expect(a.cashUsd - a.startingBalance).toBe(closed.pnlUsd);
  expect(a.consecutiveWins).toBe(1);
});

it.skipIf(!enabled)('rejects a stale final fill after a partial exit and reconciles the fresh close', async () => {
  const p = await openPosition();
  const partial = () => settlePaperExit(p, {
    partialsTaken: 1, tokenAmount: 50, sizeUsd: 50, partialCostUsd: 50, partialPnlUsd: 9, partialFeesUsd: 1,
  }, { cashUsd: { increment: 59 }, realizedPnl: { increment: 9 } });
  expect((await Promise.all([partial(), partial()])).filter(Boolean)).toHaveLength(1);
  const finalFill = { status: 'closed', pnlUsd: 18, feesUsd: 3 };
  const finalBalance = { cashUsd: { increment: 60 }, realizedPnl: { increment: 9 } };
  expect(await settlePaperExit(p, finalFill, finalBalance)).toBeNull();
  const remaining = await prisma.position.findUniqueOrThrow({ where: { id: p.id } });
  expect(remaining.status).toBe('open');
  expect(remaining.tokenAmount).toBe(50);
  const final = await settlePaperExit(remaining, finalFill, finalBalance);
  expect(final?.cashUsd).toBe(1018);
  expect(final?.realizedPnl).toBe(18);
});

it.skipIf(!enabled)('records one live close and one account credit in concurrent settlement', async () => {
  const p = await openPosition(false);
  const fill = { status: 'closed', pnlUsd: 18, exitTx: 'test-recorded-signature' };
  const balance = { cashUsd: { increment: 119 }, realizedPnl: { increment: 18 } };
  expect(await settlePaperExit(p, fill, balance)).toBeNull();
  const settle = () => settlePositionExit(p, fill, balance);
  expect((await Promise.all([settle(), settle()])).filter(Boolean)).toHaveLength(1);
  const closed = await prisma.position.findUniqueOrThrow({ where: { id: p.id } });
  const account = await prisma.account.findUniqueOrThrow({ where: { id: p.accountId } });
  expect(closed).toMatchObject({ status: 'closed', exitTx: fill.exitTx, pnlUsd: 18 });
  expect(account).toMatchObject({ cashUsd: 1018, realizedPnl: 18 });
});
