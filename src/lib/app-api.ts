/** Shared server helpers for the /app/* pages (saved Cletus frontend), all backed by the real engine and DB. */
import type { Account, Position, User } from '@prisma/client';
import { prisma } from './db';
import { getConfig, type Config } from './config';
import { requireOnboardedUser, HttpError } from './auth';
import { resolveAccount } from './status';
import { accountSettings, accountEquity, periodPnl, invalidateAccountSettings, mem } from './engine';
import { effectiveConfig, withinTradingHours, AGGRESSION_UI, type AccountSettings } from './user-settings';
import { log } from './logger';
import { syntheticPaperAllowed } from './synthetic-paper';

export async function appContext() {
  const u = await requireOnboardedUser();
  const a = await resolveAccount(u, null);
  const c = getConfig();
  const s = await accountSettings(a.id, c, a.settings);
  return { u, a, c, s, e: effectiveConfig(c, s) };
}

export const STOPPED = 'stopped by user';
export function runState(a: Pick<Account, 'paused' | 'pauseReason'>) {
  const stopped = a.paused && (a.pauseReason ?? '').startsWith('stopped');
  return { running: !stopped, paused: a.paused && !stopped, stopped };
}

export function positionView(p: Position, e: Config) {
  const current = mem.prices.get(p.mint) ?? p.lastPrice;
  const value = p.tokenAmount * current;
  const pnlUsd = value - p.sizeUsd - p.feesUsd;
  return {
    id: p.id, symbol: p.symbol, mint: p.mint, side: 'LONG' as const, sizeUsd: p.sizeUsd, entry: p.entryPrice, current, pnlUsd,
    pnlPercent: (current / p.entryPrice - 1) * 100, stopLoss: p.entryPrice * (1 - e.stopLossPct / 100), takeProfit: p.entryPrice * (1 + e.takeProfitPct / 100),
    openedAt: p.openedAt.toISOString(), simulated: p.simulated, partialsTaken: p.partialsTaken,
  };
}

export async function tradeSession(u: User, a: Account, c: Config, s: AccountSettings) {
  const e = effectiveConfig(c, s);
  const [{ equity, open }, pnl, engineState, paperWorkerHeartbeat, paperMonitor] = await Promise.all([
    accountEquity(a),
    periodPnl(a.id, s.timezone || c.timezone),
    prisma.engineState.findUnique({ where: { id: 'global' }, select: { lastScanAt: true, lastError: true, scanCount: true } }),
    prisma.logEntry.findFirst({ where: { accountId: null, message: { startsWith: 'PAPER_WORKER_HEARTBEAT' } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, message: true } }),
    prisma.logEntry.findFirst({ where: { accountId: null, message: 'PAPER_WORKER_HEARTBEAT monitor=completed' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  const rs = runState(a);
  return {
    ...rs, pauseReason: a.pauseReason, mode: c.mode === 'live' && a.isOperator ? 'live' : 'paper',
    capital: equity, startingCapital: a.startingBalance, available: a.cashUsd, dailyRealizedPnl: pnl.day,
    dailyProfitTarget: s.dailyProfitTargetUsd, dailyMaxLoss: s.dailyMaxLossUsd,
    openPositions: open.map((p) => positionView(p, e)),
    aggression: e.aggression, aggressionKey: AGGRESSION_UI[e.aggression], positionSizePercent: s.positionSizePct ?? c.maxPositionPctOfEquity,
    positionSizeIsServer: s.positionSizePct === null, stopLossPercent: e.stopLossPct, takeProfitPercent: e.takeProfitPct,
    maxPositions: e.maxOpenPositions, withinHours: withinTradingHours(s), tradingHours: s.tradingHoursEnabled ? { start: s.tradingStart, end: s.tradingEnd, days: s.activeDays, timezone: s.timezone } : null,
    engineLastScanAt: engineState?.lastScanAt ?? null,
    engineScanCount: engineState?.scanCount ?? 0,
    engineLastError: engineState?.lastError ?? null,
    paperWorkerLastAt: paperWorkerHeartbeat?.createdAt ?? null,
    paperWorkerMessage: paperWorkerHeartbeat?.message ?? null,
    paperWorkerMonitorAt: paperMonitor?.createdAt ?? null,
    syntheticPaper: syntheticPaperAllowed(undefined, c.mode),
    user: { email: u.email },
  };
}

export async function saveSettings(accountId: string, s: AccountSettings) {
  await prisma.account.update({ where: { id: accountId }, data: { settings: JSON.stringify(s) } });
  invalidateAccountSettings(accountId);
}

/** Reset the paper account to `capital` (paper only; refuses live positions). */
export async function resetPaper(a: Account, capital: number, keepRunning: boolean) {
  const liveOpen = await prisma.position.count({ where: { accountId: a.id, status: 'open', simulated: false } });
  if (liveOpen) throw new HttpError(400, 'cannot reset an account with live positions');
  if (a.isOperator && getConfig().mode === 'live') throw new HttpError(400, 'the operator account is live; paper reset is disabled');
  await prisma.position.deleteMany({ where: { accountId: a.id, simulated: true } });
  await prisma.account.update({
    where: { id: a.id },
    data: { startingBalance: capital, cashUsd: capital, realizedPnl: 0, peakEquity: capital, paused: !keepRunning, pauseReason: keepRunning ? null : `${STOPPED} (reset)`, recoveryMode: false, consecutiveWins: 0, consecutiveLosses: 0 },
  });
  await log('info', `paper account reset to $${capital}${keepRunning ? ' and started' : ''}`, a.id);
}
