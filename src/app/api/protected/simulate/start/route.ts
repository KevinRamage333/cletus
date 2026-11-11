import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { errorResponse } from '@/lib/auth';
import { appContext, resetPaper } from '@/lib/app-api';
import { log } from '@/lib/logger';

/** Start Simulation: apply the configured starting capital (fresh paper account if it changed or nothing has traded yet), then run. */
export async function POST() {
  try {
    const { a, s } = await appContext();
    const capital = s.capital ?? a.startingBalance;
    const trades = await prisma.position.count({ where: { accountId: a.id } });
    if (capital !== a.startingBalance || trades === 0) await resetPaper(a, capital, true);
    else {
      await prisma.account.update({ where: { id: a.id }, data: { paused: false, pauseReason: null, consecutiveLosses: 0 } });
      await log('info', 'simulation started by user', a.id);
    }
    return NextResponse.json({ ok: true, running: true, capital });
  } catch (e) { return errorResponse(e); }
}
