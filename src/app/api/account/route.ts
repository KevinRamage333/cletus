import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { resolveAccount } from '@/lib/status';
import { log } from '@/lib/logger';

export async function POST(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const b = await req.json().catch(() => ({}));
    const a = await resolveAccount(u, b.account);
    if (b.action === 'resume') {
      await prisma.account.update({ where: { id: a.id }, data: { paused: false, pauseReason: null } });
      await log('info', 'account resumed by user', a.id);
    } else if (b.action === 'pause') {
      await prisma.account.update({ where: { id: a.id }, data: { paused: true, pauseReason: 'paused by user' } });
      await log('info', 'account paused by user', a.id);
    } else if (b.action === 'reset') {
      const open = await prisma.position.count({ where: { accountId: a.id, status: 'open', simulated: false } });
      if (open) throw new HttpError(400, 'cannot reset an account with live positions');
      await prisma.position.deleteMany({ where: { accountId: a.id } });
      await prisma.account.update({ where: { id: a.id }, data: { cashUsd: a.startingBalance, realizedPnl: 0, peakEquity: a.startingBalance, paused: false, pauseReason: null, recoveryMode: false, consecutiveWins: 0 } });
      await log('info', 'paper account reset', a.id);
    } else throw new HttpError(400, 'unknown action');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
