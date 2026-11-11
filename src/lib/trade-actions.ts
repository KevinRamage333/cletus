import { prisma } from './db';
import { HttpError } from './auth';
import { appContext, STOPPED, tradeSession } from './app-api';
import { closePosition, mem } from './engine';
import { log } from './logger';

/**
 * start/resume: allow new entries. pause: no new entries; open positions keep being managed (stops/TPs still fire).
 * stop: no new entries AND close this account's open paper positions at the current price. Live positions are never
 * force-sold from here; use the kill switch for that.
 */
export async function tradeAction(action: 'start' | 'pause' | 'resume' | 'stop') {
  const { u, a, c, s } = await appContext();
  if (action === 'start' || action === 'resume') {
    await prisma.account.update({ where: { id: a.id }, data: { paused: false, pauseReason: null, consecutiveLosses: 0 } });
  } else if (action === 'pause') {
    await prisma.account.update({ where: { id: a.id }, data: { paused: true, pauseReason: 'paused by user' } });
  } else if (action === 'stop') {
    await prisma.account.update({ where: { id: a.id }, data: { paused: true, pauseReason: STOPPED } });
    const open = await prisma.position.findMany({ where: { accountId: a.id, status: 'open', simulated: true } });
    for (const p of open) await closePosition(p.id, mem.prices.get(p.mint) ?? p.lastPrice, 'manual_stop');
  } else throw new HttpError(400, 'unknown action');
  await log('info', `trading ${action} by user`, a.id);
  const fresh = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
  return { ok: true, ...(await tradeSession(u, fresh, c, s)) };
}

export async function closeOwnPosition(id: string) {
  const { u, a } = await appContext();
  const p = await prisma.position.findUnique({ where: { id } });
  if (!p || p.status !== 'open') throw new HttpError(404, 'open position not found');
  if (p.accountId !== a.id && !(u.isAdmin && !p.simulated)) throw new HttpError(403, 'not your position');
  if (!p.simulated && !u.isAdmin) throw new HttpError(403, 'only an admin can close a live position');
  await closePosition(p.id, mem.prices.get(p.mint) ?? p.lastPrice, 'manual_close');
  const after = await prisma.position.findUnique({ where: { id } });
  return { ok: true, status: after?.status, pnlUsd: after?.pnlUsd ?? null };
}
