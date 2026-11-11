/**
 * The Cletus engine: scan -> score -> audit -> size -> compliance gate -> enter;
 * monitor -> exit -> learn. Runs in-process on the Next.js Node server.
 *
 * Simulation mode (default): real DexScreener/RugCheck/Jupiter-quote data, paper fills, nothing signed.
 * Live mode: only the operator account trades, via Jupiter, signed with the server wallet.
 */
import type { Account, Position } from '@prisma/client';
import { prisma } from './db';
import { log } from './logger';
import { getConfig, isWithinSchedule, SIGNAL_NAMES, type Config, type SignalName } from './config';
import { discoverSolanaMints, fetchPairsForMints, fetchSolPriceUsd, type DexPair } from './dexscreener';
import { rankCandidates, updateWeights, normaliseWeights, type ScanCandidate, type SignalBreakdown } from './signals';
import { computePositionSize } from './sizing';
import { complianceGate, concentrationCap } from './compliance';
import { exitDecision } from './exits';
import { auditToken, type AuditResult } from './audit';
import { onFailure, onSuccess, isPaused, classifyError, type HealParams, type HealState, type FailureKind } from './healer';

interface EngineMemory {
  started: boolean;
  scanning: boolean;
  monitoring: boolean;
  timers: NodeJS.Timeout[];
  candidates: Array<ScanCandidate & { audit?: AuditResult }>;
  solPrice: number;
  lastScanSummary: string;
  prices: Map<string, number>;
}
const g = globalThis as unknown as { __cletusEngine?: EngineMemory };
export const mem: EngineMemory = (g.__cletusEngine ??= {
  started: false, scanning: false, monitoring: false, timers: [], candidates: [], solPrice: 0, lastScanSummary: 'not started', prices: new Map(),
});

const healParams = (c: Config): HealParams => ({
  basePriorityFee: c.priorityFeeLamports, baseSlippageBps: Math.round(c.slippageTolerance * 10000), escalation: c.priorityFeeEscalation,
  maxPriorityFee: c.maxPriorityFeeLamports, widenStepBps: c.slippageWidenStepBps, maxSlippageBps: c.maxSlippageBps,
  maxConsecutiveFailures: c.maxConsecutiveFailures, pauseMinutes: c.failurePauseMinutes,
});

export async function getEngineState() {
  const c = getConfig();
  return prisma.engineState.upsert({
    where: { id: 'global' },
    create: { id: 'global', priorityFeeLamports: c.priorityFeeLamports, slippageBps: Math.round(c.slippageTolerance * 10000) },
    update: {},
  });
}

async function heal(kind: 'ok' | FailureKind, err?: string) {
  const c = getConfig();
  const st = await getEngineState();
  const s: HealState = { priorityFeeLamports: st.priorityFeeLamports, slippageBps: st.slippageBps, consecutiveFailures: st.consecutiveFailures, pausedUntil: st.pausedUntil };
  const next = kind === 'ok' ? onSuccess(s, healParams(c)) : onFailure(s, kind, healParams(c));
  await prisma.engineState.update({ where: { id: 'global' }, data: { ...next, lastError: kind === 'ok' ? st.lastError : err ?? kind } });
  if (kind !== 'ok') {
    await log('warn', `self-heal: ${kind} failure #${next.consecutiveFailures} -> priority fee ${next.priorityFeeLamports} lamports, slippage ${next.slippageBps} bps${next.pausedUntil ? `, PAUSED until ${next.pausedUntil.toISOString()}` : ''}`);
  }
  return next;
}

export async function getWeights(): Promise<Record<SignalName, number>> {
  const c = getConfig();
  const rows = await prisma.signalWeight.findMany();
  if (rows.length !== SIGNAL_NAMES.length) {
    const w = normaliseWeights(c.initialWeights, 0);
    for (const k of SIGNAL_NAMES) await prisma.signalWeight.upsert({ where: { name: k }, create: { name: k, weight: w[k] }, update: {} });
    return w;
  }
  return Object.fromEntries(rows.map((r) => [r.name, r.weight])) as Record<SignalName, number>;
}

export async function ensureOperatorAccount() {
  const c = getConfig();
  const existing = await prisma.account.findFirst({ where: { isOperator: true } });
  if (existing) return existing;
  return prisma.account.create({ data: { name: 'Operator (server wallet)', isOperator: true, startingBalance: c.simStartingBalanceUsd, cashUsd: c.simStartingBalanceUsd, peakEquity: c.simStartingBalanceUsd } });
}

export async function createPaperAccount(userId: string, email: string) {
  const c = getConfig();
  return prisma.account.upsert({
    where: { userId },
    create: { userId, name: `Paper: ${email}`, startingBalance: c.simStartingBalanceUsd, cashUsd: c.simStartingBalanceUsd, peakEquity: c.simStartingBalanceUsd },
    update: {},
  });
}

function startOfPeriod(period: 'day' | 'week' | 'month', tz: string, now = new Date()): Date {
  // Compute the wall-clock date in tz, then approximate its UTC start.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(now).map((p) => [p.type, p.value]));
  const local = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  const offsetMs = new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  let start = new Date(local.getTime() - offsetMs);
  if (period === 'week') {
    const idx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
    start = new Date(start.getTime() - idx * 86_400_000);
  } else if (period === 'month') {
    start = new Date(new Date(`${parts.year}-${parts.month}-01T00:00:00Z`).getTime() - offsetMs);
  }
  return start;
}

export async function periodPnl(accountId: string, tz: string) {
  const [d, w, m] = await Promise.all(
    (['day', 'week', 'month'] as const).map(async (p) => {
      const agg = await prisma.position.aggregate({ where: { accountId, status: 'closed', closedAt: { gte: startOfPeriod(p, tz) } }, _sum: { pnlUsd: true } });
      return agg._sum.pnlUsd ?? 0;
    }),
  );
  return { day: d, week: w, month: m };
}

export function positionValue(p: Position, price?: number) {
  return p.tokenAmount * (price ?? p.lastPrice);
}

export async function accountEquity(a: Account) {
  const open = await prisma.position.findMany({ where: { accountId: a.id, status: 'open' } });
  const openValue = open.reduce((s, p) => s + positionValue(p), 0);
  const exposure = open.reduce((s, p) => s + p.sizeUsd, 0);
  return { equity: a.cashUsd + openValue, openValue, exposure, open };
}

/** Why an account may not open new trades right now (null = allowed). */
async function entryBlockReason(a: Account, c: Config): Promise<string | null> {
  if (a.paused) return `account paused: ${a.pauseReason ?? 'manual'}`;
  const p = await periodPnl(a.id, c.timezone);
  if (p.day <= c.dailyLossLimit) return `daily loss limit hit (${p.day.toFixed(2)})`;
  if (p.week <= c.weeklyLossLimit) return `weekly loss limit hit (${p.week.toFixed(2)})`;
  if (p.month <= c.monthlyLossLimit) return `monthly loss limit hit (${p.month.toFixed(2)})`;
  if (p.day >= c.dailyPnlTarget) return `daily PnL target reached (${p.day.toFixed(2)})`;
  return null;
}

// ─── Scan & entries ───────────────────────────────────────────────────────────

export async function scanTick(): Promise<string> {
  if (mem.scanning) return 'scan already running';
  mem.scanning = true;
  const c = getConfig();
  try {
    const st = await getEngineState();
    if (st.killSwitch) return (mem.lastScanSummary = 'kill switch active — scanning halted');
    if (isPaused({ ...st })) return (mem.lastScanSummary = `self-heal pause until ${st.pausedUntil?.toISOString()}`);

    let pairs: Map<string, DexPair>;
    try {
      const mints = await discoverSolanaMints();
      pairs = await fetchPairsForMints(mints);
      mem.solPrice = await fetchSolPriceUsd(c.solPriceFallbackUsd);
    } catch (e) {
      await heal('api', String((e as Error).message));
      return (mem.lastScanSummary = `scan failed: ${(e as Error).message}`);
    }
    if (st.consecutiveFailures > 0) await heal('ok');

    const weights = await getWeights();
    const ranked = rankCandidates([...pairs.values()], c, weights);
    for (const r of ranked) mem.prices.set(r.mint, r.priceUsd);
    const eligible = ranked.filter((r) => !r.rejected);
    mem.candidates = ranked.slice(0, c.scanTopN);
    await prisma.engineState.update({ where: { id: 'global' }, data: { lastScanAt: new Date(), scanCount: { increment: 1 } } });

    const qualified = eligible.filter((r) => r.composite >= c.minCompositeScore).sort((a, b) => b.composite - a.composite);
    let summary = `scanned ${pairs.size} Solana pairs, ${eligible.length} in $${c.minMarketCap / 1000}k-$${c.maxMarketCap / 1000}k band, ${qualified.length} >= score ${c.minCompositeScore}`;

    if (!isWithinSchedule(c)) {
      summary += ' — outside trading schedule, no entries';
      await log('info', summary);
      return (mem.lastScanSummary = summary);
    }

    const accounts = await prisma.account.findMany({ where: { OR: [{ isOperator: true }, { user: { is: { walletSetupAt: { not: null } } } }] } });
    let opened = 0;
    for (const cand of qualified.slice(0, c.auditTopN)) {
      const audit = await auditToken(cand.mint, {
        priceUsd: cand.priceUsd, sizeUsd: Math.min(c.maxPositionSizeUsd, 1000),
        params: { maxHolderConcentration: c.maxHolderConcentration, requireLiquidityLock: c.requireLiquidityLock, minLpLockedPct: c.minLpLockedPct, maxAuditRiskScore: c.maxAuditRiskScore, maxSellPriceImpactPct: c.maxSellPriceImpactPct },
        rugcheckApiKey: c.rugcheckApiKey, jupiterBase: c.jupiterBaseUrl, jupiterApiKey: c.jupiterApiKey,
      });
      const mc = mem.candidates.find((x) => x.mint === cand.mint);
      if (mc) mc.audit = audit;
      if (!audit.passed) {
        await log('info', `audit FAILED ${cand.symbol} (${cand.mint.slice(0, 6)}…): ${audit.checks.filter((x) => !x.passed).map((x) => `${x.name}: ${x.detail}`).join(' | ')}`);
        continue;
      }
      for (const a of accounts) if (await tryEnter(a, cand, audit, c)) opened++;
    }
    summary += `, opened ${opened} position(s)`;
    await log('info', summary);
    return (mem.lastScanSummary = summary);
  } catch (e) {
    await log('error', `scanTick error: ${(e as Error).message}`);
    return (mem.lastScanSummary = `error: ${(e as Error).message}`);
  } finally {
    mem.scanning = false;
  }
}

async function tryEnter(acct: Account, cand: ScanCandidate, audit: AuditResult, c: Config): Promise<boolean> {
  const a = await prisma.account.findUniqueOrThrow({ where: { id: acct.id } });
  const blocked = await entryBlockReason(a, c);
  if (blocked) return false;
  const { equity, exposure, open } = await accountEquity(a);
  if (open.length >= c.maxOpenPositions) return false;

  const size = computePositionSize(
    { equityUsd: equity, cashUsd: a.cashUsd, openExposureUsd: exposure, cumulativePnl: a.realizedPnl, recoveryMode: a.recoveryMode },
    c,
  );
  if (size.sizeUsd <= 0) return false;

  const history = await prisma.position.findMany({
    where: { accountId: a.id, OR: [{ status: 'open' }, { closedAt: { gte: new Date(Date.now() - Math.max(c.secWashTradeWindowMin, 5) * 60_000) } }, { openedAt: { gte: new Date(Date.now() - 5 * 60_000) } }] },
    select: { mint: true, openedAt: true, closedAt: true },
  });
  const liquidity = cand.liquidityUsd ?? audit.liquidityUsd;
  // Liquidity-aware sizing: never request more than the concentration limits allow.
  const cap = concentrationCap(cand.volume24h, liquidity, { maxVolumeShare: c.secMaxVolumeShare, maxLiquidityShare: c.secMaxLiquidityShare });
  const requested = Math.min(size.sizeUsd, cap);
  if (requested < size.sizeUsd) size.notes.push(`liquidity-aware cap $${cap.toFixed(2)}`);
  const gate = complianceGate(
    { mint: cand.mint, sizeUsd: requested, volume24hUsd: cand.volume24h, liquidityUsd: liquidity, history },
    { maxVolumeShare: c.secMaxVolumeShare, maxLiquidityShare: c.secMaxLiquidityShare, washTradeWindowMin: c.secWashTradeWindowMin, maxTradesPer5Min: c.secMaxTradesPer5Min },
    c.minTradeUsd,
  );
  if (!gate.allowed) {
    await log('info', `compliance gate blocked ${cand.symbol}: ${gate.reasons.join('; ')}`, a.id);
    return false;
  }
  const sizeUsd = gate.adjustedSizeUsd;
  const st = await getEngineState();
  const live = c.mode === 'live' && a.isOperator;

  let fillPrice: number, tokenAmount: number, fees: number, entryTx: string | null = null;
  if (live) {
    try {
      const { executeSwap, SOL_MINT } = await import('./executor');
      const lamports = BigInt(Math.floor((sizeUsd / mem.solPrice) * 1e9));
      const r = await executeSwap(c, { inputMint: SOL_MINT, outputMint: cand.mint, amountRaw: lamports, slippageBps: st.slippageBps, priorityFeeLamports: st.priorityFeeLamports });
      const { tokenBalanceRaw } = await import('./executor');
      const bal = await tokenBalanceRaw(c, cand.mint);
      tokenAmount = Number(bal.raw) / 10 ** bal.decimals;
      fillPrice = tokenAmount > 0 ? sizeUsd / tokenAmount : cand.priceUsd;
      fees = (st.priorityFeeLamports / 1e9) * mem.solPrice;
      entryTx = r.signature;
      await heal('ok');
    } catch (e) {
      await heal(classifyError(e), (e as Error).message);
      await log('error', `LIVE buy failed ${cand.symbol}: ${(e as Error).message}`, a.id);
      return false;
    }
  } else {
    const impact = liquidity && liquidity > 0 ? Math.min(c.slippageTolerance, sizeUsd / liquidity) : c.slippageTolerance;
    fillPrice = cand.priceUsd * (1 + impact);
    tokenAmount = sizeUsd / fillPrice;
    fees = (sizeUsd * c.simFeeBps) / 10000 + (st.priorityFeeLamports / 1e9) * (mem.solPrice || c.solPriceFallbackUsd);
  }

  await prisma.$transaction([
    prisma.position.create({
      data: {
        accountId: a.id, mint: cand.mint, symbol: cand.symbol, pairAddress: cand.pairAddress, simulated: !live,
        entryPrice: fillPrice, sizeUsd, tokenAmount, feesUsd: fees, highestPrice: fillPrice, lastPrice: cand.priceUsd,
        compositeScore: cand.composite, signals: JSON.stringify(cand.signals), tier: size.tier, entryTx,
      },
    }),
    prisma.account.update({ where: { id: a.id }, data: { cashUsd: { decrement: sizeUsd + fees } } }),
  ]);
  await log('trade', `${live ? 'LIVE' : 'PAPER'} BUY ${cand.symbol} $${sizeUsd.toFixed(2)} @ ${fillPrice.toPrecision(6)} (score ${cand.composite.toFixed(3)}, mcap $${Math.round(cand.marketCap).toLocaleString()}, tier ${size.tier} ${size.multiplier}x; ${size.notes.join(', ')})`, a.id);
  return true;
}

// ─── Monitoring & exits ──────────────────────────────────────────────────────

export async function monitorTick(): Promise<void> {
  if (mem.monitoring) return;
  mem.monitoring = true;
  const c = getConfig();
  try {
    const st = await getEngineState();
    const open = await prisma.position.findMany({ where: { status: 'open' } });
    if (!open.length) return;
    const mints = [...new Set(open.map((p) => p.mint))];
    try {
      const pairs = await fetchPairsForMints(mints);
      for (const [m, p] of pairs) if (Number(p.priceUsd) > 0) mem.prices.set(m, Number(p.priceUsd));
    } catch (e) {
      await log('warn', `price refresh failed: ${(e as Error).message}`);
    }
    for (const p of open) {
      const price = mem.prices.get(p.mint) ?? p.lastPrice;
      const highest = Math.max(p.highestPrice, price);
      if (price !== p.lastPrice || highest !== p.highestPrice) await prisma.position.update({ where: { id: p.id }, data: { lastPrice: price, highestPrice: highest } });
      const reason = st.killSwitch ? 'kill_switch' : exitDecision({ entryPrice: p.entryPrice, highestPrice: p.highestPrice, openedAt: p.openedAt }, price, { ...c });
      if (reason) await closePosition(p.id, price, reason);
    }
  } catch (e) {
    await log('error', `monitorTick error: ${(e as Error).message}`);
  } finally {
    mem.monitoring = false;
  }
}

export async function closePosition(positionId: string, price: number, reason: string) {
  const c = getConfig();
  const p = await prisma.position.findUnique({ where: { id: positionId } });
  if (!p || p.status !== 'open') return;
  const a = await prisma.account.findUniqueOrThrow({ where: { id: p.accountId } });
  const st = await getEngineState();
  const live = !p.simulated;
  let proceeds: number, exitFees: number, exitPrice: number, exitTx: string | null = null;

  if (live) {
    try {
      const { executeSwap, tokenBalanceRaw, SOL_MINT } = await import('./executor');
      const bal = await tokenBalanceRaw(c, p.mint);
      if (bal.raw === 0n) throw new Error('no on-chain token balance to sell');
      const r = await executeSwap(c, { inputMint: p.mint, outputMint: SOL_MINT, amountRaw: bal.raw, slippageBps: st.slippageBps, priorityFeeLamports: st.priorityFeeLamports });
      proceeds = (Number(r.outAmount) / 1e9) * mem.solPrice;
      exitPrice = proceeds / p.tokenAmount;
      exitFees = (st.priorityFeeLamports / 1e9) * mem.solPrice;
      exitTx = r.signature;
      await heal('ok');
    } catch (e) {
      await heal(classifyError(e), (e as Error).message);
      await log('error', `LIVE sell failed ${p.symbol} (${reason}): ${(e as Error).message} — will retry next tick`, a.id);
      return;
    }
  } else {
    const impact = Math.min(c.slippageTolerance, 0.01); // conservative simulated exit impact
    exitPrice = price * (1 - impact);
    proceeds = p.tokenAmount * exitPrice;
    exitFees = (proceeds * c.simFeeBps) / 10000 + (st.priorityFeeLamports / 1e9) * (mem.solPrice || c.solPriceFallbackUsd);
  }

  const pnlUsd = proceeds - exitFees - p.sizeUsd - p.feesUsd;
  const pnlPct = (pnlUsd / p.sizeUsd) * 100;
  const won = pnlUsd > 0;

  await prisma.position.update({ where: { id: p.id }, data: { status: 'closed', closedAt: new Date(), exitPrice, pnlUsd, pnlPct, exitReason: reason, exitTx, lastPrice: price, feesUsd: p.feesUsd + exitFees } });

  // Account bookkeeping, drawdown & recovery mode.
  const updated = await prisma.account.update({ where: { id: a.id }, data: { cashUsd: { increment: proceeds - exitFees }, realizedPnl: { increment: pnlUsd }, consecutiveWins: won ? { increment: 1 } : 0 } });
  const { equity } = await accountEquity(updated);
  const peak = Math.max(updated.peakEquity, equity);
  const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
  const data: Partial<Account> = { peakEquity: peak };
  if (c.enableRecoveryMode && !updated.recoveryMode && dd >= c.maxDrawdownPct / 2) { data.recoveryMode = true; await log('warn', `recovery mode ON (drawdown ${dd.toFixed(1)}%) — sizes x${c.recoveryMultiplier}`, a.id); }
  if (updated.recoveryMode && updated.consecutiveWins >= c.recoveryExitWins) { data.recoveryMode = false; await log('info', `recovery mode OFF after ${updated.consecutiveWins} wins`, a.id); }
  if (dd >= c.maxDrawdownPct) { data.paused = true; data.pauseReason = `max drawdown ${dd.toFixed(1)}% >= ${c.maxDrawdownPct}%`; await log('warn', `account PAUSED: ${data.pauseReason}`, a.id); }
  await prisma.account.update({ where: { id: a.id }, data });

  // Self-learning weight update (global, from every closed trade).
  const before = await getWeights();
  let after = before;
  if (c.enableDynamicWeights) {
    const sig = JSON.parse(p.signals) as SignalBreakdown;
    const w = updateWeights(before, sig, won, { winAmplify: c.winAmplify, lossDampen: c.lossDampen, minWeight: c.minSignalWeight });
    after = w;
    for (const k of SIGNAL_NAMES) {
      const active = (sig[k] ?? 0) > 0.1;
      await prisma.signalWeight.update({ where: { name: k }, data: { weight: w[k], trials: active ? { increment: 1 } : undefined, wins: active && won ? { increment: 1 } : undefined } });
    }
  }
  void import('./journal').then((j) => j.journalTrade(p.id));
  void import('./journal').then((j) => j.writeTradeReflection(p.id, before, after));
  await log('trade', `${live ? 'LIVE' : 'PAPER'} SELL ${p.symbol} (${reason}) @ ${exitPrice.toPrecision(6)} PnL ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%)`, a.id);
}

// ─── Kill switch ─────────────────────────────────────────────────────────────

export async function setKillSwitch(active: boolean, reason: string) {
  await getEngineState();
  await prisma.engineState.update({ where: { id: 'global' }, data: { killSwitch: active, killReason: active ? reason : null, killedAt: active ? new Date() : null } });
  await log('warn', active ? `KILL SWITCH ACTIVATED: ${reason} — halting entries and closing all positions` : 'kill switch released');
  if (active) await monitorTick(); // closes everything immediately
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export async function startEngine() {
  if (mem.started) return;
  mem.started = true;
  const c = getConfig();
  await getEngineState();
  await getWeights();
  await ensureOperatorAccount();
  if (c.mode === 'live') {
    const { getOperatorPublicKey } = await import('./wallet');
    if (!getOperatorPublicKey()) await setKillSwitch(true, 'live mode but the trading wallet could not be loaded');
  }
  if (c.liveBlockedReason) await log('warn', `live trading NOT enabled: ${c.liveBlockedReason}. Running in SIMULATION.`);
  await log('info', `engine start: mode=${c.mode.toUpperCase()} preset=${c.preset} aggression=${c.aggression} scan every ${c.tradeFrequencySeconds}s, monitor every ${c.positionMonitorSeconds}s`);
  if (process.env.ENGINE_DISABLED === 'true') { mem.lastScanSummary = 'engine disabled (ENGINE_DISABLED=true)'; return; }
  mem.timers.push(setInterval(() => void scanTick(), c.tradeFrequencySeconds * 1000));
  mem.timers.push(setInterval(() => void monitorTick(), c.positionMonitorSeconds * 1000));
  // World events + daily journal
  const newsMin = Math.max(5, Number(process.env.NEWS_REFRESH_MINUTES ?? 30));
  const runNews = () => import('./news').then((n) => n.refreshNewsAndBriefing()).catch((e) => log('warn', `news refresh failed: ${e.message}`));
  const runDaily = () => import('./journal').then((j) => j.writeDailyJournals()).catch((e) => log('warn', `daily journal failed: ${e.message}`));
  if (process.env.NEWS_DISABLED !== 'true') { setTimeout(runNews, 8000); mem.timers.push(setInterval(runNews, newsMin * 60_000)); }
  mem.timers.push(setInterval(runDaily, 60 * 60_000));
  setTimeout(runDaily, 60_000);
  setTimeout(() => void scanTick(), 3000);
  // World events + self-reflection (Brain context only; never affects execution).
  if (process.env.NEWS_DISABLED !== 'true') {
    const { refreshNews } = await import('./news');
    const newsMs = Math.max(5, Number(process.env.NEWS_REFRESH_MINUTES) || 15) * 60_000;
    setTimeout(() => void refreshNews().catch(() => undefined), 5000);
    mem.timers.push(setInterval(() => void refreshNews().catch(() => undefined), newsMs));
  }
  const { dailyReflections } = await import('./journal');
  mem.timers.push(setInterval(() => void dailyReflections().catch(() => undefined), 60 * 60_000));
  setTimeout(() => void dailyReflections().catch(() => undefined), 60_000);
}
