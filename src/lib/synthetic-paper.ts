import type { Account } from '@prisma/client';
import { prisma } from './db';
import { HttpError } from './auth';
import { getConfig } from './config';

export const SYNTHETIC_SYMBOL = 'SYN';
export const SYNTHETIC_MINT = 'SyntheticPaperMint111111111111111111111111';
const SIZE_USD = 25;
const ENTRY = 1;
const EXIT = 1.1;
const FEE = 0.1;

type SyntheticEnv = {
  CLETUS_SYNTHETIC_PAPER?: string;
  CI?: string;
  NODE_ENV?: string;
  VITEST?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
};

function envFlag(env?: SyntheticEnv): SyntheticEnv {
  if (env) return env;
  return {
    CLETUS_SYNTHETIC_PAPER: process.env.CLETUS_SYNTHETIC_PAPER,
    CI: process.env.CI,
    NODE_ENV: process.env.NODE_ENV,
    VITEST: process.env.VITEST,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
}

/** CI and the test runner only. A passed env is the whole environment under test. */
export function syntheticPaperRuntimeAllowed(env: SyntheticEnv): boolean {
  if (env.VERCEL === '1' || env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'production') return false;
  const inCi = env.CI === 'true' || env.CI === '1';
  const inTest = env.NODE_ENV === 'test' || env.VITEST === 'true' || env.VITEST === '1';
  return inCi || inTest;
}

/** Test-only switch. Live mode and Vercel preview/production never enable it. */
export function syntheticPaperAllowed(env?: SyntheticEnv, mode: string = 'simulation'): boolean {
  const flags = envFlag(env);
  return flags.CLETUS_SYNTHETIC_PAPER === '1' && mode !== 'live' && syntheticPaperRuntimeAllowed(flags);
}

export function assertSyntheticPaper(env?: SyntheticEnv, mode = getConfig().mode): void {
  if (mode === 'live') throw new HttpError(403, 'Synthetic paper fills stay off while live trading is on.');
  if (!syntheticPaperAllowed(envFlag(env), mode)) throw new HttpError(404, 'Not found.');
}

const BUY_COST = SIZE_USD + FEE;

/** Book a simulated fill locally. No quote, signature, or broadcast. */
export async function syntheticPaperFill(account: Account, side: 'buy' | 'sell') {
  assertSyntheticPaper();
  if (side === 'buy') {
    const position = await prisma.$transaction(async (tx) => {
      const taken = await tx.account.updateMany({
        where: { id: account.id, cashUsd: { gte: BUY_COST } },
        data: { cashUsd: { decrement: BUY_COST } },
      });
      if (taken.count !== 1) throw new HttpError(400, 'Insufficient paper cash for this synthetic buy.');
      return tx.position.create({
        data: {
          accountId: account.id,
          network: 'solana',
          mint: SYNTHETIC_MINT,
          symbol: SYNTHETIC_SYMBOL,
          status: 'open',
          simulated: true,
          entryPrice: ENTRY,
          sizeUsd: SIZE_USD,
          tokenAmount: SIZE_USD / ENTRY,
          feesUsd: FEE,
          highestPrice: ENTRY,
          lastPrice: ENTRY,
          compositeScore: 0,
          signals: '{}',
        },
      });
    });
    return { ok: true, side: 'buy' as const, simulated: true, signed: false, broadcast: false, symbol: SYNTHETIC_SYMBOL, id: position.id };
  }
  if (side !== 'sell') throw new HttpError(400, 'side must be buy or sell');
  const open = await prisma.position.findFirst({
    where: { accountId: account.id, status: 'open', simulated: true, symbol: SYNTHETIC_SYMBOL },
    orderBy: { openedAt: 'desc' },
  });
  if (!open) throw new HttpError(400, 'No synthetic paper position to sell.');
  const proceeds = open.tokenAmount * EXIT;
  const remainder = proceeds - FEE - open.sizeUsd - open.feesUsd;
  const basis = open.sizeUsd + open.partialCostUsd;
  const pnlPct = basis > 0 ? (remainder / basis) * 100 : 0;
  await prisma.$transaction([
    prisma.position.update({
      where: { id: open.id },
      data: {
        status: 'closed',
        closedAt: new Date(),
        exitPrice: EXIT,
        lastPrice: EXIT,
        pnlUsd: remainder,
        pnlPct,
        exitReason: 'synthetic_paper',
        feesUsd: open.feesUsd + FEE,
      },
    }),
    prisma.account.update({
      where: { id: account.id },
      data: { cashUsd: { increment: proceeds - FEE }, realizedPnl: { increment: remainder } },
    }),
  ]);
  return { ok: true, side: 'sell' as const, simulated: true, signed: false, broadcast: false, symbol: SYNTHETIC_SYMBOL, pnlUsd: remainder };
}
