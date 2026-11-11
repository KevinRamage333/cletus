/**
 * The Cletus engine: scan -> score -> audit -> size -> compliance gate -> enter;
 * monitor -> exit -> learn. Runs in-process on the Next.js Node server.
 *
 * Simulation mode (default): real DexScreener/RugCheck/Jupiter-quote data, paper fills, nothing signed.
 * Live mode: only the operator account trades, via Jupiter, signed with the server wallet.
 */
import { simBuy, simSell, simFeesUsd } from './sim-quote';
import { shouldChargeOperatorFee } from './jupiter';
import type { Account, Position } from '@prisma/client';
import { prisma } from './db';
import { log } from './logger';
import { getConfig, applyOwnerPlan, isWithinSchedule, SIGNAL_NAMES, MCAP_PRESETS, type Config, type SignalName, type McapPreset } from './config';
import { discoverSolanaMints, fetchPairsForMints, fetchSolPriceUsd, type DexPair } from './dexscreener';
import { rankCandidates, updateWeights, normaliseWeights, type ScanCandidate, type SignalBreakdown } from './signals';
import { computePositionSize, computeOwnerTradeSize } from './sizing';
import { complianceGate, concentrationCap } from './compliance';
import { exitDecision, partialTakeProfit } from './exits';
import { flowExitFor, entryVerdict } from './flow-collector';
import { simFillPrice } from './fills';
import { narrativeOf, portfolioCheck, mapLimit } from './portfolio';
import { parseSettings, effectiveConfig, withinTradingHours, dailyLimitHit, sizeFromPct, type AccountSettings } from './user-settings';
import { hardRiskBlock, capByEquityPct, lossStreakPause } from './risk';
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
  liquidity: Map<string, number>;
  monitorTicks: number;
}
const g = globalThis as unknown as { __cletusEngine?: EngineMemory };
export const mem: EngineMemory = (g.__cletusEngine ??= {
  started: false, scanning: false, monitoring: false, timers: [], candidates: [], solPrice: 0, lastScanSummary: 'not started', prices: new Map(), liquidity: new Map(), monitorTicks: 0,
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


/** Paper fills: charge the operator fee on user accounts; skip the operator/server wallet unless OPERATOR_FEE_ON_OWNER. */
async function chargeOperatorFeeForAccount(a: { isOperator: boolean }): Promise<boolean> {
  let taker: string | null = null;
  if (a.isOperator) {
    try {
      const { getOperatorPublicKey } = await import('./wallet');
      taker = getOperatorPublicKey();
    } catch { taker = null; }
  }
  return shouldChargeOperatorFee(taker, { isOwnerAccount: a.isOperator });
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

const settingsCache = new Map<string, { at: number; s: AccountSettings }>();
/** Per-account settings (Config page), cached for 5s. Call invalidateAccountSettings after a save. */
export async function accountSettings(accountId: string, c: Config, raw?: string | null): Promise<AccountSettings> {
  const hit = settingsCache.get(accountId);
  if (raw === undefined && hit && Date.now() - hit.at < 5000) return hit.s;
  const json = raw !== undefined ? raw : (await prisma.account.findUnique({ where: { id: accountId }, select: { settings: true } }))?.settings;
  const st = parseSettings(json, c);
  settingsCache.set(accountId, { at: Date.now(), s: st });
  return st;
}
export function invalidateAccountSettings(accountId: string) { settingsCache.delete(accountId); }

/** Why an account may not open new trades right now (null = allowed). */
async function entryBlockReason(a: Account, c: Config): Promise<string | null> {
  if (a.paused) return `account paused: ${a.pauseReason ?? 'manual'}`;
  const p = await periodPnl(a.id, c.timezone);
  const { equity } = await accountEquity(a);
  const hard = hardRiskBlock({ dayPnlUsd: p.day, equityUsd: equity, consecutiveLosses: a.consecutiveLosses }, { dailyLossLimitUsd: c.dailyLossLimit, maxDailyLossPct: c.maxDailyLossPct, maxPositionPctOfEquity: c.maxPositionPctOfEquity, maxConsecutiveLosses: c.maxConsecutiveLosses });
  if (hard) return hard;
  if (p.week <= c.weeklyLossLimit) return `weekly loss limit hit (${p.week.toFixed(2)})`;
  if (p.month <= c.monthlyLossLimit) return `monthly loss limit hit (${p.month.toFixed(2)})`;
  if (p.day >= c.dailyPnlTarget) return `daily PnL target reached (${p.day.toFixed(2)})`;
  if (!a.labPreset) {
    const us = await accountSettings(a.id, c, a.settings);
    const hit = dailyLimitHit(us, p.day);
    if (hit) {
      await prisma.account.update({ where: { id: a.id }, data: { paused: true, pauseReason: `auto-paused: ${hit}` } });
      await log('warn', `account auto-paused: ${hit}`, a.id);
      return hit;
    }
    if (!withinTradingHours(us)) return `outside your trading hours (${us.tradingStart}–${us.tradingEnd} ${us.timezone})`;
  }
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
    for (const r of ranked) { mem.prices.set(r.mint, r.priceUsd); if (r.liquidityUsd) mem.liquidity.set(r.mint, r.liquidityUsd); }
    const eligible = ranked.filter((r) => !r.rejected);
    mem.candidates = ranked.slice(0, c.scanTopN);
    await prisma.engineState.update({ where: { id: 'global' }, data: { lastScanAt: new Date(), scanCount: { increment: 1 } } });

    const accounts = await prisma.account.findMany({ where: { labPreset: null, OR: [{ isOperator: true }, { user: { is: { walletSetupAt: { not: null } } } }] } });
    // Each account may pick its own aggression (Config page): audit anything that clears the loosest account threshold.
    let minScore = c.minCompositeScore;
    for (const a of accounts) minScore = Math.min(minScore, effectiveConfig(c, await accountSettings(a.id, c, a.settings)).minCompositeScore);
    const qualified = eligible.filter((r) => r.composite >= minScore).sort((a, b) => b.composite - a.composite);
    let summary = `scanned ${pairs.size} Solana pairs, ${eligible.length} in $${c.minMarketCap / 1000}k-$${c.maxMarketCap / 1000}k band, ${qualified.length} >= score ${minScore}`;

    if (!isWithinSchedule(c)) {
      summary += ' — outside trading schedule, no entries';
      await log('info', summary);
      return (mem.lastScanSummary = summary);
    }

    let opened = 0;
    for (const cand of qualified.slice(0, c.auditTopN)) {
      // On-chain flow + X hype: confirmer/veto only (SIGNAL_VETO_MODE=shadow logs, on blocks, off ignores). Never a buy trigger.
      const verdict = entryVerdict(cand.mint);
      if (verdict.mode !== 'off' && verdict.veto) {
        await log('info', `${verdict.mode === 'on' ? 'flow veto' : 'flow veto (shadow, not enforced)'} ${cand.symbol}: ${verdict.reasons.join(' | ')}`);
        if (verdict.mode === 'on') continue;
      }
      const audit = await auditToken(cand.mint, {
        priceUsd: cand.priceUsd, sizeUsd: Math.min(c.maxPositionSizeUsd, 1000),
        params: { maxHolderConcentration: c.maxHolderConcentration, requireLiquidityLock: c.requireLiquidityLock, minLpLockedPct: c.minLpLockedPct, maxAuditRiskScore: c.maxAuditRiskScore, maxSellPriceImpactPct: c.maxSellPriceImpactPct, maxTop10HolderPct: c.maxTop10HolderPct, devSellCheck: c.devSellCheck, blockIfDevExited: c.blockIfDevExited, devExitLookbackHours: c.devExitLookbackHours },
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
    if (c.enablePresetLab) summary += await presetLabTick([...pairs.values()], weights, c);
    await log('info', summary);
    return (mem.lastScanSummary = summary);
  } catch (e) {
    await log('error', `scanTick error: ${(e as Error).message}`);
    return (mem.lastScanSummary = `error: ${(e as Error).message}`);
  } finally {
    mem.scanning = false;
  }
}

async function tryEnter(acct: Account, cand: ScanCandidate, audit: AuditResult, serverCfg: Config): Promise<boolean> {
  const a = await prisma.account.findUniqueOrThrow({ where: { id: acct.id } });
  const us = a.labPreset ? null : await accountSettings(a.id, serverCfg, a.settings);
  const c = applyOwnerPlan(us ? effectiveConfig(serverCfg, us) : serverCfg, a.isOperator);
  if (cand.composite < c.minCompositeScore) return false;
  const blocked = await entryBlockReason(a, c);
  if (blocked) return false;
  const { equity, exposure, open } = await accountEquity(a);
  const narrative = narrativeOf(cand.symbol, cand.name);
  const creator = audit.creator ?? null;
  const pre = portfolioCheck(open, { mint: cand.mint, sizeUsd: Number.MAX_SAFE_INTEGER, narrative, creator }, equity, { maxOpenPositions: c.maxOpenPositions, maxTotalExposurePct: c.maxTotalExposurePct, maxPositionsPerCluster: c.maxPositionsPerCluster });
  if (!pre.allowed) { if (!pre.reasons.some((r) => r.startsWith('max open') || r.startsWith('duplicate'))) await log('info', `portfolio cap blocked ${cand.symbol}: ${pre.reasons.join('; ')}`, a.id); return false; }

  let size = computePositionSize(
    { equityUsd: equity, cashUsd: a.cashUsd, openExposureUsd: exposure, cumulativePnl: a.realizedPnl, recoveryMode: a.recoveryMode },
    c,
  );
  if (a.isOperator && c.ownerPlan.enabled) {
    const solPrice = mem.solPrice || c.solPriceFallbackUsd;
    let equityUsd = equity;
    let cashUsd = a.cashUsd;
    if (c.mode === 'live') {
      try {
        const { connection } = await import('./executor');
        const { getOperatorPublicKey } = await import('./wallet');
        const { PublicKey } = await import('@solana/web3.js');
        const { LAMPORTS_PER_SOL } = await import('./withdraw');
        const op = getOperatorPublicKey();
        if (op) {
          const lamports = await connection(c).getBalance(new PublicKey(op));
          cashUsd = (lamports / LAMPORTS_PER_SOL) * solPrice;
          equityUsd = cashUsd + (equity - a.cashUsd);
        }
      } catch { /* book equity is the fallback */ }
    }
    const o = computeOwnerTradeSize(
      { equityUsd, cashUsd, solPriceUsd: solPrice, feeReserveSol: c.ownerPlan.feeReserveSol, minTradeUsd: c.minTradeUsd },
      c.ownerPlan.sizeTiers, c.ownerPlan.sizeStepUsd, c.ownerPlan.sizeIncrementUsd,
    );
    size = { sizeUsd: o.sizeUsd, tier: 1, multiplier: 1, notes: o.notes };
  }
  if (us && us.positionSizePct !== null) { size.sizeUsd = Math.min(sizeFromPct(us, equity, size.sizeUsd), a.cashUsd); size.notes.push(`${us.positionSizePct}% of equity (your setting)`); }
  const eqCap = capByEquityPct(size.sizeUsd, equity, c.maxPositionPctOfEquity);
  if (eqCap.capped) { size.sizeUsd = eqCap.sizeUsd; size.notes.push(`capped at ${c.maxPositionPctOfEquity}% of equity`); }
  if (size.sizeUsd > pre.maxSizeUsd) { size.sizeUsd = pre.maxSizeUsd; size.notes.push(`capped by ${c.maxTotalExposurePct}% portfolio exposure`); }
  if (size.sizeUsd < c.minTradeUsd) return false;

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
    // Realistic paper fill from a keyless Jupiter V2 /order quote (impact + feeBps incl. 50 bps new-token fee); model fallback.
    const chargeFee = await chargeOperatorFeeForAccount(a);
    const q = await simBuy({ mint: cand.mint, sizeUsd, mid: cand.priceUsd, solPriceUsd: (mem.solPrice || c.solPriceFallbackUsd), liquidityUsd: liquidity, fallbackImpact: c.slippageTolerance, ageHours: cand.ageHours, chargeOperatorFee: chargeFee });
    fillPrice = q.fillPrice;
    tokenAmount = sizeUsd / fillPrice;
    fees = simFeesUsd(sizeUsd, q.source === 'jupiter' ? q.feeBps : Math.max(c.simFeeBps, q.feeBps), st.priorityFeeLamports, (mem.solPrice || c.solPriceFallbackUsd));
  }

  await prisma.$transaction([
    prisma.position.create({
      data: {
        accountId: a.id, mint: cand.mint, symbol: cand.symbol, pairAddress: cand.pairAddress, simulated: !live,
        entryPrice: fillPrice, sizeUsd, tokenAmount, feesUsd: fees, highestPrice: fillPrice, lastPrice: cand.priceUsd,
        compositeScore: cand.composite, signals: JSON.stringify(cand.signals), tier: size.tier, entryTx, narrative, creator,
      },
    }),
    prisma.account.update({ where: { id: a.id }, data: { cashUsd: { decrement: sizeUsd + fees } } }),
  ]);
  await log('trade', `${live ? 'LIVE' : 'PAPER'} BUY ${cand.symbol} $${sizeUsd.toFixed(2)} @ ${fillPrice.toPrecision(6)} (score ${cand.composite.toFixed(3)}, mcap $${Math.round(cand.marketCap).toLocaleString()}, tier ${size.tier} ${size.multiplier}x; ${size.notes.join(', ')})`, a.id);
  if (live) {
    try {
      const { appendLiveTrade } = await import('./live-trade-log');
      const acc = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
      const eq = await accountEquity(acc);
      appendLiveTrade({
        type: 'buy', side: 'buy', token: cand.symbol, symbol: cand.symbol, mint: cand.mint,
        sizeUsd, price: fillPrice, entryPrice: fillPrice, signature: entryTx, equityUsd: eq.equity, simulated: false,
      });
    } catch { /* trade log must never block a fill */ }
  }
  return true;
}

// ─── Preset lab: paper-only accounts that trade each market-cap preset side by side ─────────

export async function ensureLabAccount(preset: McapPreset) {
  const c = getConfig();
  return prisma.account.upsert({
    where: { labPreset: preset },
    create: { name: `Paper lab: ${MCAP_PRESETS[preset].label}`, labPreset: preset, startingBalance: c.simStartingBalanceUsd, cashUsd: c.simStartingBalanceUsd, peakEquity: c.simStartingBalanceUsd },
    update: {},
  });
}

async function presetLabTick(pairs: DexPair[], weights: Record<SignalName, number>, c: Config): Promise<string> {
  const parts: string[] = [];
  for (const preset of Object.keys(MCAP_PRESETS) as McapPreset[]) {
    try {
      const band = MCAP_PRESETS[preset];
      const lab = await ensureLabAccount(preset);
      const ranked = rankCandidates(pairs, { ...c, minMarketCap: band.min, maxMarketCap: band.max }, weights);
      const q = ranked.filter((r) => !r.rejected && r.composite >= c.minCompositeScore).sort((a, b) => b.composite - a.composite).slice(0, c.auditTopN);
      let n = 0;
      for (const cand of q) {
        const audit = await auditToken(cand.mint, {
          priceUsd: cand.priceUsd, sizeUsd: Math.min(c.maxPositionSizeUsd, 1000),
          params: { maxHolderConcentration: c.maxHolderConcentration, requireLiquidityLock: c.requireLiquidityLock, minLpLockedPct: c.minLpLockedPct, maxAuditRiskScore: c.maxAuditRiskScore, maxSellPriceImpactPct: c.maxSellPriceImpactPct, maxTop10HolderPct: c.maxTop10HolderPct, devSellCheck: c.devSellCheck, blockIfDevExited: c.blockIfDevExited, devExitLookbackHours: c.devExitLookbackHours },
          rugcheckApiKey: c.rugcheckApiKey, jupiterBase: c.jupiterBaseUrl, jupiterApiKey: c.jupiterApiKey,
        });
        if (audit.passed && (await tryEnter(lab, cand, audit, { ...c, mode: 'simulation' }))) n++;
      }
      parts.push(`${preset.toLowerCase()} ${ranked.filter((r) => !r.rejected).length}/${n}`);
    } catch (e) { parts.push(`${preset.toLowerCase()} err`); await log('warn', `preset lab ${preset}: ${(e as Error).message}`); }
  }
  return `; lab (eligible/opened): ${parts.join(', ')}`;
}

// ─── Monitoring & exits ──────────────────────────────────────────────────────

/** Jupiter Price v3 (near real-time) for up to 50 mints per call; DexScreener is the fallback. */
async function fetchFastPrices(mints: string[]): Promise<Map<string, number>> {
  // Jupiter Price API V3 via the shared, rate-limited Jupiter client; skipped (DexScreener fallback below) if the bucket is busy.
  try {
    const { jupPrices } = await import('./jupiter');
    return new Map(Object.entries(await jupPrices(mints, { maxWaitMs: 3000 })));
  } catch { return new Map(); }
}

async function evaluatePosition(p: Position, price: number, killSwitch: boolean, serverCfg: Config) {
  const acct = await prisma.account.findUnique({ where: { id: p.accountId }, select: { isOperator: true } });
  const c = applyOwnerPlan(effectiveConfig(serverCfg, await accountSettings(p.accountId, serverCfg)), !!acct?.isOperator);
  const highest = Math.max(p.highestPrice, price);
  if (price !== p.lastPrice || highest !== p.highestPrice) await prisma.position.update({ where: { id: p.id }, data: { lastPrice: price, highestPrice: highest } });
  // Fast exit on a dev dump or smart-money / whale exit (on-chain flow; WHALE_FAST_EXIT=off disables).
  const reason = killSwitch ? 'kill_switch' : flowExitFor(p.mint) ?? exitDecision({ entryPrice: p.entryPrice, highestPrice: highest, openedAt: p.openedAt }, price, { ...c });
  if (reason) { await closePosition(p.id, price, reason); return; }
  const partial = partialTakeProfit(p, price, c.tpLadder, p.partialsTaken, c.takeProfitPct);
  if (partial) await partialClose(p.id, price, partial.fraction, partial.rung, partial.gainPct);
}

const fastChecks = new Map<string, number>();
/** Called from the Helius WebSocket when a position's pool account changes: re-price that token now. */
async function onPoolChange(mint: string) {
  const now = Date.now();
  if (now - (fastChecks.get(mint) ?? 0) < Number(process.env.WS_EXIT_DEBOUNCE_MS ?? 1000)) return;
  fastChecks.set(mint, now);
  try {
    const c = getConfig();
    const st = await getEngineState();
    const px = (await fetchFastPrices([mint])).get(mint);
    if (!px) return;
    mem.prices.set(mint, px);
    const open = await prisma.position.findMany({ where: { status: 'open', mint } });
    await mapLimit(open, 4, (p) => evaluatePosition(p, px, st.killSwitch, c));
  } catch { /* polling is the backstop */ }
}

export async function monitorTick(): Promise<void> {
  if (mem.monitoring) return;
  mem.monitoring = true;
  const c = getConfig();
  try {
    const st = await getEngineState();
    const open = await prisma.position.findMany({ where: { status: 'open' } });
    // Keep Helius WebSocket pool subscriptions in sync with open positions (fast exits).
    const { syncPoolSubscriptions } = await import('./helius');
    syncPoolSubscriptions(new Map(open.filter((p) => p.pairAddress).map((p) => [p.pairAddress as string, p.mint])), (m) => void onPoolChange(m));
    if (!open.length) {
      void import('./profit-sweep').then((m) => m.maybeRunProfitSweep()).catch(() => undefined);
      return;
    }
    const mints = [...new Set(open.map((p) => p.mint))];
    const fast = await fetchFastPrices(mints);
    for (const [m, v] of fast) mem.prices.set(m, v);
    const missing = mints.filter((m) => !fast.has(m));
    const needLiq = mints.filter((m) => !mem.liquidity.has(m));
    if (missing.length || needLiq.length || mem.monitorTicks % 10 === 0) {
      try {
        const pairs = await fetchPairsForMints([...new Set([...missing, ...needLiq, ...(mem.monitorTicks % 10 === 0 ? mints : [])])]);
        for (const [m, p] of pairs) {
          if (!fast.has(m) && Number(p.priceUsd) > 0) mem.prices.set(m, Number(p.priceUsd));
          if (p.liquidity?.usd) mem.liquidity.set(m, p.liquidity.usd);
        }
      } catch (e) {
        await log('warn', `price refresh failed: ${(e as Error).message}`);
      }
    }
    mem.monitorTicks++;
    // Evaluate every open position concurrently (bounded so live sells don't flood the RPC).
    await mapLimit(open, Number(process.env.EXIT_CONCURRENCY ?? 8), (p) => evaluatePosition(p, mem.prices.get(p.mint) ?? p.lastPrice, st.killSwitch, c));
  } catch (e) {
    await log('error', `monitorTick error: ${(e as Error).message}`);
  } finally {
    mem.monitoring = false;
  }
}

/** Sell `fraction` of the remaining position at a take-profit rung; the rest keeps running. */
export async function partialClose(positionId: string, price: number, fraction: number, rung: number, gainPct: number) {
  const c = getConfig();
  const p = await prisma.position.findUnique({ where: { id: positionId } });
  if (!p || p.status !== 'open' || p.partialsTaken >= rung) return;
  const st = await getEngineState();
  const sellTokens = p.tokenAmount * fraction;
  const costPortion = p.sizeUsd * fraction;
  let proceeds: number, fee: number, tx: string | null = null;
  if (!p.simulated) {
    try {
      const { executeSwap, tokenBalanceRaw, SOL_MINT } = await import('./executor');
      const bal = await tokenBalanceRaw(c, p.mint);
      const raw = (bal.raw * BigInt(Math.round(fraction * 10_000))) / 10_000n;
      if (raw === 0n) throw new Error('nothing to sell');
      const r = await executeSwap(c, { inputMint: p.mint, outputMint: SOL_MINT, amountRaw: raw, slippageBps: st.slippageBps, priorityFeeLamports: st.priorityFeeLamports });
      proceeds = (Number(r.outAmount) / 1e9) * mem.solPrice; fee = (st.priorityFeeLamports / 1e9) * mem.solPrice; tx = r.signature;
      await heal('ok');
    } catch (e) {
      await heal(classifyError(e), (e as Error).message);
      await log('error', `LIVE partial sell failed ${p.symbol}: ${(e as Error).message}`, p.accountId);
      return;
    }
  } else {
    const acct = await prisma.account.findUnique({ where: { id: p.accountId }, select: { isOperator: true } });
    const chargeFee = await chargeOperatorFeeForAccount({ isOperator: !!acct?.isOperator });
    const q = await simSell({ mint: p.mint, tokenAmount: sellTokens, mid: price, liquidityUsd: mem.liquidity.get(p.mint), fallbackImpact: c.slippageTolerance, chargeOperatorFee: chargeFee });
    proceeds = sellTokens * q.fillPrice;
    fee = simFeesUsd(proceeds, q.source === 'jupiter' ? q.feeBps : Math.max(c.simFeeBps, q.feeBps), st.priorityFeeLamports, (mem.solPrice || c.solPriceFallbackUsd));
  }
  const pnl = proceeds - fee - costPortion;
  await prisma.$transaction([
    prisma.position.update({ where: { id: p.id }, data: { tokenAmount: p.tokenAmount - sellTokens, sizeUsd: p.sizeUsd - costPortion, partialCostUsd: p.partialCostUsd + costPortion, partialPnlUsd: p.partialPnlUsd + pnl, partialsTaken: rung, lastPrice: price } }),
    prisma.account.update({ where: { id: p.accountId }, data: { cashUsd: { increment: proceeds - fee }, realizedPnl: { increment: pnl } } }),
  ]);
  await log('trade', `${p.simulated ? 'PAPER' : 'LIVE'} PARTIAL TP${rung} ${p.symbol}: sold ${(fraction * 100).toFixed(0)}% at +${gainPct}% rung, PnL ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}${tx ? ` tx ${tx}` : ''}`, p.accountId);
  if (!p.simulated) {
    try {
      const { appendLiveTrade } = await import('./live-trade-log');
      const acc = await prisma.account.findUniqueOrThrow({ where: { id: p.accountId } });
      const eq = await accountEquity(acc);
      appendLiveTrade({
        type: 'sell', side: 'sell', token: p.symbol, symbol: p.symbol, mint: p.mint,
        sizeUsd: costPortion, price, exitPrice: price, pnlUsd: pnl, signature: tx, equityUsd: eq.equity,
        reason: `partial_tp${rung}`, simulated: false,
      });
    } catch { /* trade log must never block a fill */ }
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
    // Realistic: fill at the observed (possibly gapped) price, minus pool price impact for our size.
    const chargeFee = await chargeOperatorFeeForAccount(a);
    const q = await simSell({ mint: p.mint, tokenAmount: p.tokenAmount, mid: price, liquidityUsd: mem.liquidity.get(p.mint), fallbackImpact: c.slippageTolerance, chargeOperatorFee: chargeFee });
    exitPrice = q.fillPrice;
    proceeds = p.tokenAmount * exitPrice;
    exitFees = simFeesUsd(proceeds, q.source === 'jupiter' ? q.feeBps : Math.max(c.simFeeBps, q.feeBps), st.priorityFeeLamports, (mem.solPrice || c.solPriceFallbackUsd));
  }

  const remainderPnl = proceeds - exitFees - p.sizeUsd - p.feesUsd;
  const pnlUsd = remainderPnl + p.partialPnlUsd; // whole-trade P&L incl. partial take-profits
  const pnlPct = (pnlUsd / (p.sizeUsd + p.partialCostUsd)) * 100;
  const won = pnlUsd > 0;

  await prisma.position.update({ where: { id: p.id }, data: { status: 'closed', closedAt: new Date(), exitPrice, pnlUsd, pnlPct, exitReason: reason, exitTx, lastPrice: price, feesUsd: p.feesUsd + exitFees } });

  // Account bookkeeping, drawdown & recovery mode.
  const updated = await prisma.account.update({ where: { id: a.id }, data: { cashUsd: { increment: proceeds - exitFees }, realizedPnl: { increment: remainderPnl }, consecutiveWins: won ? { increment: 1 } : 0, consecutiveLosses: won ? 0 : { increment: 1 } } });
  const { equity } = await accountEquity(updated);
  const peak = Math.max(updated.peakEquity, equity);
  const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
  const data: Partial<Account> = { peakEquity: peak };
  if (c.enableRecoveryMode && !updated.recoveryMode && dd >= c.maxDrawdownPct / 2) { data.recoveryMode = true; await log('warn', `recovery mode ON (drawdown ${dd.toFixed(1)}%) — sizes x${c.recoveryMultiplier}`, a.id); }
  if (updated.recoveryMode && updated.consecutiveWins >= c.recoveryExitWins) { data.recoveryMode = false; await log('info', `recovery mode OFF after ${updated.consecutiveWins} wins`, a.id); }
  if (!won && lossStreakPause(updated.consecutiveLosses, c.maxConsecutiveLosses) && !updated.paused) { data.paused = true; data.pauseReason = `${updated.consecutiveLosses} losses in a row (MAX_CONSECUTIVE_LOSSES=${c.maxConsecutiveLosses})`; await log('warn', `account AUTO-PAUSED: ${data.pauseReason}`, a.id); }
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
  void import('./journal').then((j) => j.writeTradeReflection(p.id, before, after));
  await log('trade', `${live ? 'LIVE' : 'PAPER'} SELL ${p.symbol} (${reason}) @ ${exitPrice.toPrecision(6)} PnL ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%)`, a.id);
  if (live) {
    try {
      const { appendLiveTrade } = await import('./live-trade-log');
      appendLiveTrade({
        type: 'sell', side: 'sell', token: p.symbol, symbol: p.symbol, mint: p.mint,
        sizeUsd: p.sizeUsd + p.partialCostUsd, price: exitPrice, entryPrice: p.entryPrice, exitPrice,
        pnlUsd, pnlPct, signature: exitTx, equityUsd: equity, reason, simulated: false,
      });
    } catch { /* trade log must never block a fill */ }
  }
  if (a.isOperator) void import('./profit-sweep').then((m) => m.maybeRunProfitSweep()).catch(() => undefined);
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
  const { startRpcHealthChecks } = await import('./rpc-pool');
  startRpcHealthChecks();
  if (c.mode === 'live') {
    const { getOperatorPublicKey } = await import('./wallet');
    if (!getOperatorPublicKey()) await setKillSwitch(true, 'live mode but the trading wallet could not be loaded');
  }
  if (c.liveBlockedReason) await log('warn', `live trading NOT enabled: ${c.liveBlockedReason}. Running in SIMULATION.`);
  const plan = c.ownerPlan;
  await log('info', `engine start: mode=${c.mode.toUpperCase()} preset=${c.preset} aggression=${c.aggression} scan every ${c.tradeFrequencySeconds}s, monitor every ${c.positionMonitorSeconds}s; owner plan ${plan.enabled ? `on (1 pos, SL ${plan.stopLossPct}% / TP ${plan.takeProfitPct}%, sweep ${plan.sweepArmed ? 'armed' : 'paused'})` : 'off'}`);
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
  const ownerSync = () => import('./owner-sync').then((m) => m.syncHaltAndPublishSnapshot()).catch(() => undefined);
  setTimeout(ownerSync, 1500);
  mem.timers.push(setInterval(ownerSync, 4000));
}
