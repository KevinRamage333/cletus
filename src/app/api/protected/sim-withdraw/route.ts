import { NextResponse } from 'next/server';
import { errorResponse, HttpError } from '@/lib/auth';
import { appContext } from '@/lib/app-api';
import { prisma } from '@/lib/db';
import { checkSimWithdraw } from '@/lib/sim-withdraw';

export const dynamic = 'force-dynamic';

/** GET → simulated cash + history. POST { chain, to, amountUsd } → SIMULATED withdrawal to the user's own wallet. No funds move. */
export async function GET() {
  try {
    const { u, a } = await appContext();
    const rows = await prisma.withdrawal.findMany({ where: { userId: u.id, mode: 'simulation-usd' }, orderBy: { createdAt: 'desc' }, take: 10 });
    return NextResponse.json({
      simulated: true, cashUsd: a.cashUsd, solanaWallet: u.walletPublicKey ?? null,
      history: rows.map((r) => ({ at: r.createdAt, to: r.toAddress, usd: Number(r.lamports) / 100, status: r.status })),
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request) {
  try {
    const { u, a } = await appContext();
    if (a.isOperator || a.labPreset) throw new HttpError(400, 'This is the house trading account; owner withdrawals go through the owner desk');
    const b = await req.json().catch(() => ({}));
    const c = checkSimWithdraw(b, { walletPublicKey: u.walletPublicKey ?? null }, a.cashUsd);
    if (!c.ok) throw new HttpError(400, c.error);
    const usd = c.cents / 100;
    // Conditional debit: two concurrent requests cannot push simulated cash below zero (Audit N9).
    await prisma.$transaction(async (tx) => {
      const debit = await tx.account.updateMany({ where: { id: a.id, cashUsd: { gte: usd } }, data: { cashUsd: { decrement: usd } } });
      if (debit.count !== 1) throw new HttpError(409, 'Not enough simulated cash for this withdrawal.');
      await tx.withdrawal.create({ data: { userId: u.id, toAddress: `${c.chain}:${c.to}`.slice(0, 64), lamports: String(c.cents), mode: 'simulation-usd', status: 'simulated' } });
    });
    return NextResponse.json({ ok: true, simulated: true, message: `SIMULATED: $${usd.toFixed(2)} withdrawn to your ${c.chain === 'base' ? 'Base app' : 'Solana'} wallet. No real funds moved.` });
  } catch (e) { return errorResponse(e); }
}
