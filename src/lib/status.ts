import type { Account, User } from '@prisma/client';
import { prisma } from './db';
import { getConfig, isWithinSchedule, publicConfig } from './config';
import { accountEquity, getEngineState, getWeights, mem, periodPnl, ensureOperatorAccount } from './engine';
import { tierFor } from './sizing';
import { computeScorecard } from './scorecard';
import { getOperatorPublicKey } from './wallet';
import { tradeFeeView, solscanTxUrl, solscanAccountUrl } from './approvals';

export async function resolveAccount(user: User, which?: string | null): Promise<Account> {
  if (which === 'operator' && user.isAdmin) return ensureOperatorAccount();
  const a = await prisma.account.findUnique({ where: { userId: user.id } });
  if (a) return a;
  const { createPaperAccount } = await import('./engine');
  return createPaperAccount(user.id, user.email);
}

export async function buildStatus(user: User, account: Account) {
  const c = getConfig();
  const [st, weightsRows, eq, closed, logs, pnl] = await Promise.all([
    getEngineState(),
    prisma.signalWeight.findMany(),
    accountEquity(account),
    prisma.position.findMany({ where: { accountId: account.id, status: 'closed' }, orderBy: { closedAt: 'desc' }, take: 50 }),
    prisma.logEntry.findMany({ where: { OR: [{ accountId: account.id }, { accountId: null }] }, orderBy: { createdAt: 'desc' }, take: 80 }),
    periodPnl(account.id, c.timezone),
  ]);
  await getWeights();
  const totalClosed = await prisma.position.count({ where: { accountId: account.id, status: 'closed' } });
  const wins = await prisma.position.count({ where: { accountId: account.id, status: 'closed', pnlUsd: { gt: 0 } } });
  const open = eq.open.map((p) => {
    const fees = tradeFeeView({ sizeUsd: p.sizeUsd, feesUsd: p.feesUsd, tokenAmount: p.tokenAmount });
    return {
      id: p.id, symbol: p.symbol, mint: p.mint, simulated: p.simulated, sizeUsd: p.sizeUsd, entryPrice: p.entryPrice, lastPrice: p.lastPrice,
      value: p.tokenAmount * p.lastPrice, pnlUsd: p.tokenAmount * p.lastPrice - p.sizeUsd - p.feesUsd, pnlPct: (p.lastPrice / p.entryPrice - 1) * 100,
      openedAt: p.openedAt, compositeScore: p.compositeScore, tier: p.tier, feesUsd: p.feesUsd,
      operatorFeeUsd: fees.entryOperatorFeeUsd, operatorFeeBps: fees.operatorFeeBps,
      entryTx: p.entryTx, solscanEntry: solscanTxUrl(p.entryTx), solscanMint: solscanAccountUrl(p.mint),
    };
  });
  const allClosed = await prisma.position.findMany({ where: { accountId: account.id, status: 'closed' }, select: { pnlUsd: true, pnlPct: true, closedAt: true }, orderBy: { closedAt: 'desc' }, take: 5000 });
  const scorecard = computeScorecard(allClosed.map((t) => ({ pnlUsd: t.pnlUsd ?? 0, pnlPct: t.pnlPct ?? 0, closedAt: t.closedAt ?? new Date() })), account.startingBalance);
  const unrealized = open.reduce((s, p) => s + p.pnlUsd, 0);
  const tier = tierFor(account.realizedPnl, c.tiers);
  return {
    user: { email: user.email, isAdmin: user.isAdmin, walletPublicKey: user.walletPublicKey },
    config: publicConfig(c),
    operatorWallet: user.isAdmin ? getOperatorPublicKey() : null,
    engine: {
      killSwitch: st.killSwitch, killReason: st.killReason, priorityFeeLamports: st.priorityFeeLamports, slippageBps: st.slippageBps,
      consecutiveFailures: st.consecutiveFailures, pausedUntil: st.pausedUntil, lastScanAt: st.lastScanAt, lastError: st.lastError,
      scanCount: st.scanCount, lastScanSummary: mem.lastScanSummary, withinSchedule: isWithinSchedule(c), solPrice: mem.solPrice,
    },
    account: {
      id: account.id, name: account.name, isOperator: account.isOperator, startingBalance: account.startingBalance, cash: account.cashUsd,
      equity: eq.equity, exposure: eq.exposure, realizedPnl: account.realizedPnl, unrealizedPnl: unrealized, paused: account.paused, pauseReason: account.pauseReason,
      recoveryMode: account.recoveryMode, peakEquity: account.peakEquity, tier: tier.tier, tierMultiplier: tier.multiplier,
      closedTrades: totalClosed, winRate: totalClosed ? wins / totalClosed : null, pnl, consecutiveLosses: account.consecutiveLosses,
    },
    scorecard,
    presetComparison: await presetComparison(),
    rpc: (await import('./rpc-pool')).rpcStatus(),
    heliusWs: (await import('./helius')).wsStatus(),
    geminiModelActive: (await import('./brain/gemini')).activeGeminiModel(c.geminiModel),
    open,
    closed: closed.map((p) => {
      const fees = tradeFeeView({ sizeUsd: p.sizeUsd, feesUsd: p.feesUsd, tokenAmount: p.tokenAmount, exitPrice: p.exitPrice });
      return { id: p.id, symbol: p.symbol, mint: p.mint, sizeUsd: p.sizeUsd, entryPrice: p.entryPrice, exitPrice: p.exitPrice, pnlUsd: p.pnlUsd, pnlPct: p.pnlPct, exitReason: p.exitReason, openedAt: p.openedAt, closedAt: p.closedAt, simulated: p.simulated, feesUsd: p.feesUsd, operatorFeeUsd: fees.operatorFeeUsd, operatorFeeBps: fees.operatorFeeBps, entryTx: p.entryTx, exitTx: p.exitTx, solscanEntry: solscanTxUrl(p.entryTx), solscanExit: solscanTxUrl(p.exitTx), solscanMint: solscanAccountUrl(p.mint) };
    }),
    weights: weightsRows.map((w) => ({ name: w.name, weight: w.weight, wins: w.wins, trials: w.trials })),
    candidates: mem.candidates.map((x) => ({
      mint: x.mint, symbol: x.symbol, marketCap: x.marketCap, volume24h: x.volume24h, liquidityUsd: x.liquidityUsd, volMcap: x.volMcap, priceChangeH1: x.priceChangeH1,
      composite: x.composite, signals: x.signals, rejected: x.rejected ?? null, url: x.url,
      audit: x.audit ? { passed: x.audit.passed, failed: x.audit.checks.filter((k) => !k.passed).map((k) => `${k.name}: ${k.detail}`) } : null,
    })),
    logs: logs.map((l) => ({ id: l.id, level: l.level, message: l.message, at: l.createdAt })),
  };
}


/** Side-by-side paper results for each market-cap preset (preset lab accounts). */
export async function presetComparison() {
  const { MCAP_PRESETS } = await import('./config');
  const labs = await prisma.account.findMany({ where: { labPreset: { not: null } } });
  const out = [];
  for (const key of Object.keys(MCAP_PRESETS) as Array<keyof typeof MCAP_PRESETS>) {
    const a = labs.find((l) => l.labPreset === key);
    if (!a) { out.push({ preset: key, label: MCAP_PRESETS[key].label, equity: null, open: 0, scorecard: null }); continue; }
    const trades = await prisma.position.findMany({ where: { accountId: a.id, status: 'closed' }, select: { pnlUsd: true, pnlPct: true, closedAt: true } });
    const eq = await accountEquity(a);
    out.push({ preset: key, label: MCAP_PRESETS[key].label, equity: eq.equity, open: eq.open.length, scorecard: computeScorecard(trades.map((t) => ({ pnlUsd: t.pnlUsd ?? 0, pnlPct: t.pnlPct ?? 0, closedAt: t.closedAt ?? new Date() })), a.startingBalance) });
  }
  return out;
}
