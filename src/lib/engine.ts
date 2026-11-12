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
import type { FadeState } from './volume-fade';
import { prisma } from './db';
import { log } from './logger';
import { getConfig, applyOwnerPlan, isWithinSchedule, SIGNAL_NAMES, MCAP_PRESETS, type Config, type SignalName, type McapPreset } from './config';
import { discoverSolanaMints, fetchPairsForMints, fetchSolPriceUsd, lastDiscoveryStats, type DexPair } from './dexscreener';
import { rankCandidates, updateWeights, normaliseWeights, activeLiquidityWeights, type ScanCandidate, type SignalBreakdown } from './signals';
import { computePositionSize, computeOwnerTradeSize } from './sizing';
import { ownerRecoverySize } from './owner-plan';
import { resolveSizingBalances } from './live-sizing';
import { complianceGate, concentrationCap } from './compliance';
import { exitDecision, partialTakeProfit } from './exits';
import { flowExitFor, entryVerdict } from './flow-collector';
import { simFillPrice } from './fills';
import { narrativeOf, portfolioCheck, mapLimit } from './portfolio';
import { parseSettings, effectiveConfig, withinTradingHours, dailyLimitHit, sizeFromPct, type AccountSettings } from './user-settings';
import { hardRiskBlock, capByEquityPct, lossStreakPause } from './risk';
import { auditToken, type AuditResult } from './audit';
import { onFailure, onSuccess, isPaused, classifyError, type HealParams, type HealState, type FailureKind } from './healer';
import { withDeadline, DeadlineError, nextGen, assertCurrent, InFlight, ageSec, memoizeFor, type TickFence } from './watchdog';
import { computeExitPlan, planOverrides, planWithinBounds, describePlan, regimeStats, regimeOf, volatilityPctPerHour, HARD_BOUNDS, type PriceChange, type RegimeStats } from './adaptive-exits';
import { fastPriceOn, fastPriceParams, fastPriceFromSignature, acceptFastPrice, TrailingDebounce } from './fast-price';
import { exitSlippageBps, parseLadder, recordSellFailure, shouldWriteOff, liveFillTokenAmount, safeExitPrice, isPriceStale, type SellFailureState } from './live-exit';

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
  /** When each mint's price was last refreshed (ms). Live positions exit if this goes stale. */
  priceAt: Map<string, number>;
  /** Per-position live sell failures (separate from the global self-heal counter). */
  sellFailures: Map<string, SellFailureState>;
  /** Where the last self-heal failure came from; a clean scan only clears scan/API failures. */
  lastFailureSource: 'scan' | 'swap' | null;
  /** Watchdog: where each loop is right now, when it last finished, and the generation fence. */
  scanStage: string; monitorStage: string;
  lastScanDoneAt: number | null; lastMonitorDoneAt: number | null;
  scanFence: TickFence; monitorFence: TickFence;
  /** Positions with a sell in flight (monitor, WebSocket fast path and abandoned ticks can't double-sell). */
  selling: InFlight;
  /** Adaptive exits: latest DexScreener price change per mint, band regime from the last scan, worst price per open position. */
  pairChange: Map<string, PriceChange>;
  regime: RegimeStats | null;
  lowest: Map<string, number>;
  /** Volume-fade exit: latest DexScreener m5/h1 flow per mint, and each live position's fade clock. */
  pairFlow: Map<string, PairFlow>;
  fade: Map<string, FadeState & { lastAt: number }>;
}
interface PairFlow { m5Vol: number; h1Vol: number; buys: number; sells: number; at: number }
function notePairFlow(m: string, p: { volume?: Partial<Record<string, number>>; txns?: Record<string, { buys: number; sells: number }> }) {
  if (p.volume?.m5 === undefined) return;
  mem.pairFlow.set(m, { m5Vol: Number(p.volume.m5) || 0, h1Vol: Number(p.volume.h1) || 0, buys: p.txns?.m5?.buys ?? 0, sells: p.txns?.m5?.sells ?? 0, at: Date.now() });
}
const g = globalThis as unknown as { __cletusEngine?: EngineMemory };
export const mem: EngineMemory = (g.__cletusEngine ??= {
  started: false, scanning: false, monitoring: false, timers: [], candidates: [], solPrice: 0, lastScanSummary: 'not started', prices: new Map(), liquidity: new Map(), monitorTicks: 0,
  priceAt: new Map(), sellFailures: new Map(), lastFailureSource: null,
  scanStage: 'idle', monitorStage: 'idle', lastScanDoneAt: null, lastMonitorDoneAt: null, scanFence: { gen: 0 }, monitorFence: { gen: 0 }, selling: new InFlight(),
  pairChange: new Map(), regime: null, lowest: new Map(), pairFlow: new Map(), fade: new Map(),
});
mem.pairFlow ??= new Map(); mem.fade ??= new Map();
mem.priceAt ??= new Map();
mem.sellFailures ??= new Map();
mem.lastFailureSource ??= null;
mem.scanStage ??= 'idle'; mem.monitorStage ??= 'idle';
mem.lastScanDoneAt ??= null; mem.lastMonitorDoneAt ??= null;
mem.scanFence ??= { gen: 0 }; mem.monitorFence ??= { gen: 0 };
mem.selling ??= new InFlight();
mem.pairChange ??= new Map(); mem.regime ??= null; mem.lowest ??= new Map();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const envNum = (k: string, d: number) => { const v = Number(process.env[k]); return process.env[k] !== undefined && process.env[k] !== '' && Number.isFinite(v) ? v : d; };
function setPrice(mint: string, price: number, at = Date.now()) { mem.prices.set(mint, price); mem.priceAt.set(mint, at); }

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

async function heal(kind: 'ok' | FailureKind, err?: string, source: 'scan' | 'swap' = 'scan') {
  const c = getConfig();
  if (kind !== 'ok') mem.lastFailureSource = source;
  else mem.lastFailureSource = null;
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

export async function periodPnl(accountId: string, tz: string, opts: { liveOnly?: boolean } = {}) {
  const [d, w, m] = await Promise.all(
    (['day', 'week', 'month'] as const).map(async (p) => {
      const agg = await prisma.position.aggregate({ where: { accountId, status: 'closed', closedAt: { gte: startOfPeriod(p, tz) }, ...(opts.liveOnly ? { simulated: false } : {}) }, _sum: { pnlUsd: true } });
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

/** Losses in a row among the account's real (simulated:false) closed trades, newest first. */
export async function liveLossStreak(accountId: string): Promise<number> {
  const rows = await prisma.position.findMany({ where: { accountId, status: 'closed', simulated: false }, orderBy: { closedAt: 'desc' }, take: 50, select: { pnlUsd: true } });
  let n = 0;
  for (const r of rows) { if ((r.pnlUsd ?? 0) > 0) break; n++; }
  return n;
}

/** Operator trading wallet SOL balance in lamports (null when the key is not loaded). */
async function operatorLamports(c: Config): Promise<number | null> {
  const { connection } = await import('./executor');
  const { getOperatorPublicKey } = await import('./wallet');
  const { PublicKey } = await import('@solana/web3.js');
  const op = getOperatorPublicKey();
  if (!op) return null;
  return connection(c).getBalance(new PublicKey(op));
}

/**
 * Lamports of the whole house book for the live drawdown guard: operator wallet + the owner's KOL wallet
 * (KOL_WALLET_ADDRESS / KOL keypair). Owner transfers between the two are internal and never look like a
 * withdrawal or a loss; KOL positions (same operator account) are already in the position value.
 * Null if either wallet can't be read, so a half-read never registers as a flow.
 */
export async function houseLamports(c: Config, env: Record<string, string | undefined> = process.env): Promise<number | null> {
  const { connection } = await import('./executor');
  const w = await import('./wallet');
  const { PublicKey } = await import('@solana/web3.js');
  const op = w.getOperatorPublicKey();
  if (!op) return null;
  const kol = env.KOL_WALLET_ADDRESS?.trim() || w.getKolPublicKey();
  const conn = connection(c);
  const [a, b] = await Promise.all([
    conn.getBalance(new PublicKey(op)),
    kol && kol !== op ? conn.getBalance(new PublicKey(kol)) : Promise.resolve(0),
  ]);
  return a + b;
}

/**
 * Equity written to logs/live-trades.jsonl for a live trade: the on-chain wallet (SOL x price) plus open LIVE
 * positions, never the operator's Postgres book (which still carries ~$9.7k of paper history and made the
 * owner equity curve jump). Null when the wallet can't be read; the curve then rebuilds from trade P&L.
 */
export async function liveEquityForLog(c: Config, accountId: string, getLamports: () => Promise<number | bigint | null> = () => operatorLamports(c)): Promise<number | null> {
  // KOL add-on trades use their own wallet: don't mix its balance into the operator equity curve.
  { const w = await import('./wallet'); if (typeof w.activeWalletName === 'function' && w.activeWalletName() === 'kol') return null; }
  try {
    const open = await prisma.position.findMany({ where: { accountId, status: 'open', simulated: false } });
    const bal = await resolveSizingBalances({ live: true, bookEquityUsd: 0, bookCashUsd: 0, solPriceUsd: mem.solPrice, liveOpenValueUsd: open.reduce((s, x) => s + positionValue(x), 0), getLamports });
    return bal.ok ? Math.round(bal.equityUsd * 100) / 100 : null;
  } catch { return null; }
}

/**
 * Live drawdown guard for the house wallets (operator + owner's KOL wallet): samples on-chain equity (SOL x price + open live positions),
 * tracks a deposit-adjusted live peak (live-drawdown.ts) and, only on settled samples (no bot tx in flight):
 * recovery mode ON at half of MAX_DRAWDOWN_PERCENTAGE, pause at the full value. When the owner resumes an
 * account paused for live drawdown, the live peak is rebased to the current equity so it doesn't re-pause.
 */
let liveSampling = false;
export async function sampleLiveEquity(deps: { getLamports?: () => Promise<number | bigint | null> } = {}): Promise<void> {
  const c = getConfig();
  if (c.mode !== 'live' || liveSampling) return;
  liveSampling = true;
  try {
    const ld = await import('./live-drawdown');
    const a = await prisma.account.findFirst({ where: { isOperator: true } });
    if (!a) return;
    const solPrice = mem.solPrice;
    if (!(solPrice > 0)) return;
    const lamRaw = await (deps.getLamports ?? (() => houseLamports(c)))();
    if (lamRaw === null || lamRaw === undefined) return;
    const lamports = Number(lamRaw);
    if (!Number.isFinite(lamports) || lamports < 0) return;
    const open = await prisma.position.findMany({ where: { accountId: a.id, status: 'open', simulated: false } });
    const equityUsd = (lamports / 1e9) * solPrice + open.reduce((s, x) => s + positionValue(x), 0);
    const before = ld.loadState();
    // Owner resumed after a live-drawdown pause: start a fresh peak from here.
    if (before?.ddPausedAt && !a.paused) {
      const r0 = ld.rebasePeak(equityUsd, lamports, Date.now());
      await log('warn', `LIVE drawdown pause cleared by owner; live peak rebased to $${r0.peakUsd.toFixed(2)}`, a.id);
    }
    const r = ld.observeLive({ equityUsd, lamports, solPriceUsd: solPrice, at: Date.now() });
    if (r.initialised) await log('info', `LIVE drawdown tracker started: ${ld.describeLive(r.state)}`, a.id);
    if (r.flowUsd !== 0) await log('warn', `LIVE wallet ${r.flowUsd > 0 ? 'deposit' : 'withdrawal'} detected ${r.flowUsd > 0 ? '+' : '-'}$${Math.abs(r.flowUsd).toFixed(2)} (no bot tx): peak moved with it, not counted as ${r.flowUsd > 0 ? 'profit' : 'loss'}; ${ld.describeLive(r.state)}`, a.id);
    if (!r.settled) return;
    const dd = r.drawdownPct;
    const data: Partial<Account> = {};
    if (c.enableRecoveryMode && !a.recoveryMode && dd >= c.maxDrawdownPct / 2) { data.recoveryMode = true; await log('warn', `LIVE recovery mode ON (on-chain drawdown ${dd.toFixed(1)}% >= ${(c.maxDrawdownPct / 2).toFixed(1)}%) — trades drop to the base tier; ${ld.describeLive(r.state)}`, a.id); }
    if (dd >= c.maxDrawdownPct && !a.paused) {
      data.paused = true; data.pauseReason = `live max drawdown ${dd.toFixed(1)}% >= ${c.maxDrawdownPct}% (on-chain wallet)`;
      ld.markDrawdownPause(Date.now());
      await log('warn', `account PAUSED: ${data.pauseReason}; ${ld.describeLive(r.state)}`, a.id);
    }
    if (Object.keys(data).length) await prisma.account.update({ where: { id: a.id }, data });
  } catch (e) {
    await log('warn', `LIVE equity sample failed: ${(e as Error).message}`).catch(() => undefined);
  } finally { liveSampling = false; }
}

/** Entry gating reads the wallet once per 10 s instead of once per candidate (sizing a real buy still reads fresh). */
let lamportsMemo: { key: string; get: () => Promise<number | null> } | null = null;
function cachedOperatorLamports(c: Config): Promise<number | null> {
  const key = c.rpcUrl;
  if (!lamportsMemo || lamportsMemo.key !== key) lamportsMemo = { key, get: memoizeFor(envNum('ENTRY_GATE_BALANCE_CACHE_MS', 10_000), () => operatorLamports(c)) };
  return lamportsMemo.get();
}

/**
 * Why an account may not open new trades right now (null = allowed).
 * A LIVE operator account checks its loss limits against the on-chain wallet and real
 * (simulated:false) trades only; the paper book on the same account is ignored.
 */
export async function entryBlockReason(a: Account, c: Config, deps: { getLamports?: () => Promise<number | bigint | null> } = {}): Promise<string | null> {
  if (a.paused) return `account paused: ${a.pauseReason ?? 'manual'}`;
  const liveOperator = c.mode === 'live' && a.isOperator;
  const p = await periodPnl(a.id, c.timezone, { liveOnly: liveOperator });
  let equity: number;
  let consecutiveLosses = a.consecutiveLosses;
  if (liveOperator) {
    consecutiveLosses = await liveLossStreak(a.id); // paper losses on the same account don't count
    const open = await prisma.position.findMany({ where: { accountId: a.id, status: 'open', simulated: false } });
    const bal = await resolveSizingBalances({
      live: true, bookEquityUsd: 0, bookCashUsd: 0, solPriceUsd: mem.solPrice,
      liveOpenValueUsd: open.reduce((s, x) => s + positionValue(x), 0),
      getLamports: deps.getLamports ?? (() => cachedOperatorLamports(c)),
    });
    if (!bal.ok) return `on-chain wallet balance unavailable (${bal.reason})`;
    equity = bal.equityUsd;
  } else {
    equity = (await accountEquity(a)).equity;
  }
  const hard = hardRiskBlock({ dayPnlUsd: p.day, equityUsd: equity, consecutiveLosses }, { dailyLossLimitUsd: c.dailyLossLimit, maxDailyLossPct: c.maxDailyLossPct, maxPositionPctOfEquity: c.maxPositionPctOfEquity, maxConsecutiveLosses: c.maxConsecutiveLosses });
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

/** Longest a scan / monitor tick may hold its loop before the watchdog abandons it (ms). */
export const scanDeadlineMs = () => envNum('SCAN_TICK_DEADLINE_MS', 150_000);
export const monitorDeadlineMs = () => envNum('MONITOR_TICK_DEADLINE_MS', 45_000);

export async function scanTick(): Promise<string> {
  if (mem.scanning) return 'scan already running';
  mem.scanning = true;
  const gen = nextGen(mem.scanFence);
  const started = Date.now();
  try {
    const out = await withDeadline(scanTickInner(gen), scanDeadlineMs(), 'scan tick');
    mem.lastScanDoneAt = Date.now();
    return out;
  } catch (e) {
    if (e instanceof DeadlineError) {
      nextGen(mem.scanFence); // fence off the stuck tick: it can no longer open positions
      await log('warn', `watchdog: scan stuck ${Math.round((Date.now() - started) / 1000)}s at stage "${mem.scanStage}" — abandoned, scanning resumes next tick`).catch(() => undefined);
      return (mem.lastScanSummary = `scan abandoned at ${mem.scanStage}`);
    }
    throw e;
  } finally {
    mem.scanning = false;
  }
}

async function scanTickInner(gen: number): Promise<string> {
  const c = getConfig();
  const stage = (s: string) => { if (mem.scanFence.gen === gen) mem.scanStage = s; };
  try {
    stage('engine state');
    const st = await getEngineState();
    if (st.killSwitch) return (mem.lastScanSummary = 'kill switch active — scanning halted');
    if (isPaused({ ...st })) return (mem.lastScanSummary = `self-heal pause until ${st.pausedUntil?.toISOString()}`);

    let pairs: Map<string, DexPair>;
    try {
      stage('dexscreener discovery');
      const mints = await discoverSolanaMints();
      stage('dexscreener pairs');
      pairs = await fetchPairsForMints(mints);
      stage('sol price');
      mem.solPrice = await fetchSolPriceUsd(c.solPriceFallbackUsd);
    } catch (e) {
      await heal('api', String((e as Error).message), 'scan');
      return (mem.lastScanSummary = `scan failed: ${(e as Error).message}`);
    }
    // A clean scan only clears scan/API failures; swap failures are cleared by a successful swap.
    if (st.consecutiveFailures > 0 && mem.lastFailureSource !== 'swap') await heal('ok');

    stage('rank');
    const weights = await getWeights();
    const { pumpAgeFromEnv } = await import('./pump-age');
    const paScan = pumpAgeFromEnv(process.env);
    const ranked = rankCandidates([...pairs.values()], paScan?.waiveMinTokenAge ? { ...c, minTokenAgeHours: 0 } : c, weights);
    for (const r of ranked) { setPrice(r.mint, r.priceUsd); if (r.liquidityUsd) mem.liquidity.set(r.mint, r.liquidityUsd); }
    for (const [m, p] of pairs) { if (p.priceChange) mem.pairChange.set(m, p.priceChange); notePairFlow(m, p); }
    const eligible = ranked.filter((r) => !r.rejected);
    mem.regime = regimeStats(eligible.map((r) => r.priceChangeH1));
    mem.candidates = ranked.slice(0, c.scanTopN);
    await prisma.engineState.update({ where: { id: 'global' }, data: { lastScanAt: new Date(), scanCount: { increment: 1 } } });

    const accounts = await prisma.account.findMany({ where: { labPreset: null, OR: [{ isOperator: true }, { user: { is: { walletSetupAt: { not: null } } } }] } });
    // Each account may pick its own aggression (Config page): audit anything that clears the loosest account threshold.
    let minScore = c.minCompositeScore;
    for (const a of accounts) minScore = Math.min(minScore, effectiveConfig(c, await accountSettings(a.id, c, a.settings)).minCompositeScore);
    const qualified = eligible.filter((r) => r.composite >= minScore).sort((a, b) => b.composite - a.composite);
    if (paScan) {
      const impulse = paScan.impulseHours;
      qualified.sort((a, b) => {
        const ia = a.ageHours != null && a.ageHours >= 0 && a.ageHours <= impulse ? 1 : 0;
        const ib = b.ageHours != null && b.ageHours >= 0 && b.ageHours <= impulse ? 1 : 0;
        return ib - ia || b.composite - a.composite;
      });
    }
    const topScore = eligible.reduce((m, r) => Math.max(m, r.composite), 0);
    let summary = `scanned ${pairs.size} Solana pairs, ${eligible.length} in $${c.minMarketCap / 1000}k-$${c.maxMarketCap / 1000}k band, ${qualified.length} >= score ${minScore} (top ${topScore.toFixed(3)})`;
    { const ds = lastDiscoveryStats(); summary += ` [sources: dexscreener ${ds.dexscreener}, phantom trending ${ds.phantom} (+${ds.phantomNew} new), gecko fresh +${ds.gecko}]`; }

    if (!isWithinSchedule(c)) {
      summary += ' — outside trading schedule, no entries';
      await log('info', summary);
      try {
        const { buildScanNow, writeScanLatest } = await import('./scan-latest');
        writeScanLatest(buildScanNow({ candidates: mem.candidates, minScore, summary }));
      } catch { /* panel must never break a scan */ }
      return (mem.lastScanSummary = summary);
    }

    let opened = 0;
    const scanPicked = new Set<string>();
    const scanOutcomes = new Map<string, { decision: string; reason: string }>();
    for (const cand of qualified.slice(0, c.auditTopN)) {
      // On-chain flow + X hype: confirmer/veto only (SIGNAL_VETO_MODE=shadow logs, on blocks, off ignores). Never a buy trigger.
      const verdict = entryVerdict(cand.mint);
      if (verdict.mode !== 'off' && verdict.veto) {
        await log('info', `${verdict.mode === 'on' ? 'flow veto' : 'flow veto (shadow, not enforced)'} ${cand.symbol}: ${verdict.reasons.join(' | ')}`);
        if (verdict.mode === 'on') { scanOutcomes.set(cand.mint, { decision: 'vetoed', reason: verdict.reasons.join(' | ') }); continue; }
        scanOutcomes.set(cand.mint, { decision: 'qualified', reason: `flow veto (shadow): ${verdict.reasons.join(' | ')}` });
      }
      stage(`audit ${cand.symbol}`);
      const audit = await auditToken(cand.mint, {
        priceUsd: cand.priceUsd, sizeUsd: auditSizeUsd(c),
        params: { maxHolderConcentration: c.maxHolderConcentration, requireLiquidityLock: c.requireLiquidityLock, minLpLockedPct: c.minLpLockedPct, maxAuditRiskScore: c.maxAuditRiskScore, maxSellPriceImpactPct: c.maxSellPriceImpactPct, maxTop10HolderPct: c.maxTop10HolderPct, devSellCheck: c.devSellCheck, blockIfDevExited: c.blockIfDevExited, devExitLookbackHours: c.devExitLookbackHours },
        rugcheckApiKey: c.rugcheckApiKey, jupiterBase: c.jupiterBaseUrl, jupiterApiKey: c.jupiterApiKey,
      });
      const mc = mem.candidates.find((x) => x.mint === cand.mint);
      if (mc) mc.audit = audit;
      if (!audit.passed) {
        const why = audit.checks.filter((x) => !x.passed).map((x) => `${x.name}: ${x.detail}`).join(' | ');
        await log('info', `audit FAILED ${cand.symbol} (${cand.mint.slice(0, 6)}…): ${why}`);
        scanOutcomes.set(cand.mint, { decision: 'audit failed', reason: why });
        continue;
      }
      for (const a of accounts) {
        stage(`enter ${cand.symbol}`);
        assertCurrent(mem.scanFence, gen, 'scan');
        if (await tryEnter(a, cand, audit, c, gen, scanOutcomes)) { opened++; scanPicked.add(cand.mint); scanOutcomes.set(cand.mint, { decision: 'picked', reason: 'entered' }); }
      }
    }
    // KOL / pump.fun add-on (KOL_MODE=on): its own source, band, gates, wallet and exits, alongside the main strategy.
    try { summary += await kolTick(c, weights, accounts, gen, scanOutcomes, scanPicked); } catch (e) { summary += ` [kol: error ${(e as Error).message}]`; }
    summary += `, opened ${opened} position(s)`;
    stage('preset lab');
    if (c.enablePresetLab) summary += await presetLabTick([...pairs.values()], weights, c, gen);
    await log('info', summary);
    try {
      const { buildScanNow, writeScanLatest } = await import('./scan-latest');
      writeScanLatest(buildScanNow({ candidates: mem.candidates, minScore, summary, picked: scanPicked, outcomes: scanOutcomes }));
    } catch { /* panel must never break a scan */ }
    return (mem.lastScanSummary = summary);
  } catch (e) {
    await log('error', `scanTick error: ${(e as Error).message}`);
    return (mem.lastScanSummary = `error: ${(e as Error).message}`);
  } finally {
    stage('idle');
  }
}

/** One KOL-mode round: recent KOL callouts -> $5k-$25k band -> audit + KOL gates -> entry from the KOL wallet. */
async function kolTick(c: Config, weights: Record<SignalName, number>, accounts: Account[], gen: number, outcomes: Map<string, { decision: string; reason: string }>, picked: Set<string>): Promise<string> {
  const km = await import('./kol-mode');
  const kc = km.kolConfig(process.env);
  if (!kc.enabled) return '';
  const w = await import('./wallet');
  const kolAddr = w.getKolPublicKey();
  const calls = await km.fetchKolCallouts(kc);
  const ks = km.kolStatus();
  let tag = ` [kol: ${calls.length} callout(s)${ks.lastError ? `, X: ${ks.lastError}` : ''}${kolAddr ? '' : ', NO KOL WALLET'}`;
  if (!calls.length || !kolAddr || c.mode !== 'live') return `${tag}]`;
  const pairs = await fetchPairsForMints(calls.map((x) => x.mint));
  for (const [m, p] of pairs) { if (p.priceChange) mem.pairChange.set(m, p.priceChange); notePairFlow(m, p); }
  const kcfg = { ...c, minMarketCap: kc.minMcap, maxMarketCap: kc.maxMcap, minLiquidityUsd: kc.minLiquidityUsd, minVolume24hUsd: kc.minVolume24hUsd, minVolumeMcapRatio: 0, minTokenAgeHours: 0, requireKnownAge: false };
  const ranked = rankCandidates([...pairs.values()], kcfg, weights);
  const byMint = new Map(calls.map((x) => [x.mint, x]));
  let inBand = 0, passed = 0, opened = 0;
  for (const cand of ranked) {
    setPrice(cand.mint, cand.priceUsd); if (cand.liquidityUsd) mem.liquidity.set(cand.mint, cand.liquidityUsd);
    const call = byMint.get(cand.mint);
    const who = call ? `@${call.handle}` : 'KOL';
    mem.candidates.push({ ...cand, symbol: cand.symbol, rejected: cand.rejected });
    if (cand.rejected) { outcomes.set(cand.mint, { decision: 'kol: filtered', reason: `${who}: ${cand.rejected}` }); continue; }
    inBand++;
    const audit = await auditToken(cand.mint, {
      priceUsd: cand.priceUsd, sizeUsd: auditSizeUsd(c),
      params: { maxHolderConcentration: c.maxHolderConcentration, requireLiquidityLock: c.requireLiquidityLock, minLpLockedPct: c.minLpLockedPct, maxAuditRiskScore: c.maxAuditRiskScore, maxSellPriceImpactPct: c.maxSellPriceImpactPct, maxTop10HolderPct: c.maxTop10HolderPct, devSellCheck: c.devSellCheck, blockIfDevExited: c.blockIfDevExited, devExitLookbackHours: c.devExitLookbackHours },
      rugcheckApiKey: c.rugcheckApiKey, jupiterBase: c.jupiterBaseUrl, jupiterApiKey: c.jupiterApiKey,
    });
    if (!audit.passed) {
      const why = audit.checks.filter((x) => !x.passed).map((x) => `${x.name}: ${x.detail}`).join(' | ');
      if (feedbackLogged(`kol:${cand.mint}`)) await log('info', `KOL ${who} ${cand.symbol}: audit failed (${why})`);
      outcomes.set(cand.mint, { decision: 'kol: audit failed', reason: why }); continue;
    }
    const { fetchRugcheck } = await import('./audit');
    const report = (await fetchRugcheck(cand.mint)) as (Parameters<typeof km.evaluateKolGates>[0]['report'] & { tokenMeta?: { uri?: string } }) | null;
    const [bubble, metadata] = await Promise.all([
      (await import('./bubblemaps')).bubblemapsTopClusterPct(cand.mint),
      km.fetchTokenMetadata(report?.tokenMeta?.uri),
    ]);
    const g = km.evaluateKolGates({ report, bubblemapsTopClusterPct: bubble, metadata }, kc);
    if (!g.pass) {
      if (feedbackLogged(`kol:${cand.mint}`)) await log('info', `KOL ${who} ${cand.symbol}: skipped (${g.reasons.join('; ')})`);
      outcomes.set(cand.mint, { decision: 'kol: gate', reason: g.reasons.join('; ') }); continue;
    }
    passed++;
    await log('info', `KOL ${who} ${cand.symbol}: gates passed (${g.notes.join(', ')}); mcap $${Math.round(cand.marketCap).toLocaleString()}`);
    for (const a of accounts.filter((x) => x.isOperator)) {
      assertCurrent(mem.scanFence, gen, 'scan');
      if (await w.withKolWallet(() => tryEnter(a, cand, audit, c, gen, outcomes, 'kol'))) { opened++; picked.add(cand.mint); outcomes.set(cand.mint, { decision: 'picked (kol)', reason: `${who} callout` }); }
    }
  }
  tag += `, ${inBand} in $${kc.minMcap / 1000}k-$${kc.maxMcap / 1000}k, ${passed} passed gates, opened ${opened}]`;
  return tag;
}

/**
 * USD size the audit simulates the exit sell at. The live owner plan trades $6-$10, so checking
 * sell impact on $1,000 rejected small coins we could exit fine; audit at ~2x the real size instead.
 */
export function auditSizeUsd(c: Config): number {
  if (c.mode === 'live' && c.ownerPlan.enabled) return envNum('LIVE_AUDIT_SIZE_USD', 20);
  return Math.min(c.maxPositionSizeUsd, 1000);
}

const fbLogged = new Map<string, number>();
/** Log a feedback skip at most once per mint per 15 min. */
function feedbackLogged(mint: string, now = Date.now()): boolean {
  const t = fbLogged.get(mint);
  if (t !== undefined && now - t < 15 * 60_000) return false;
  fbLogged.set(mint, now);
  return true;
}

async function tryEnter(acct: Account, cand: ScanCandidate, audit: AuditResult, serverCfg: Config, scanGen?: number, outcomes?: Map<string, { decision: string; reason: string }>, mode?: 'kol'): Promise<boolean> {
  const kol = mode === 'kol';
  const kolCfg = kol ? (await import('./kol-mode')).kolConfig(process.env) : null;
  const a = await prisma.account.findUniqueOrThrow({ where: { id: acct.id } });
  const us = a.labPreset ? null : await accountSettings(a.id, serverCfg, a.settings);
  const c = applyOwnerPlan(us ? effectiveConfig(serverCfg, us) : serverCfg, a.isOperator);
  if (!kol && cand.composite < c.minCompositeScore) return false;
  // Optional bounded feedback from the daily review (JOURNAL_FEEDBACK=on, default off): +0.025 per flagged setup, max +0.05.
  if (!kol && process.env.JOURNAL_FEEDBACK) {
    const fb = (await import('./review-runtime')).entryFeedback({ signals: cand.signals, terms: cand.terms ?? null, mcapUsd: cand.marketCap });
    if (fb.bump > 0 && cand.composite < c.minCompositeScore + fb.bump) {
      if (!a.labPreset && feedbackLogged(cand.mint)) await log('info', `review feedback: skipped ${cand.symbol} score ${cand.composite.toFixed(3)} < ${(c.minCompositeScore + fb.bump).toFixed(3)} (flagged setup: ${fb.why})`, a.id);
      return false;
    }
  }
  const blocked = await entryBlockReason(a, c);
  if (blocked) return false;
  // Re-entry cooldown (live owner): no re-buy within REENTRY_COOLDOWN_HOURS (24) of a losing live close of this coin.
  if (c.mode === 'live' && a.isOperator) {
    const { reentryBan, reentryCooldownHours } = await import('./reentry');
    const hours = reentryCooldownHours();
    if (hours > 0) {
      const last = await prisma.position.findFirst({ where: { accountId: a.id, mint: cand.mint, simulated: false, status: 'closed' }, orderBy: { closedAt: 'desc' }, select: { closedAt: true, pnlUsd: true, exitReason: true } });
      const ban = reentryBan(last, Date.now(), hours);
      if (ban) { const why = `re-entry cooldown: last live close ${ban.why}; ${Math.floor(ban.minutesLeft / 60)}h${ban.minutesLeft % 60}m left`; if (feedbackLogged(`reentry:${cand.mint}`)) await log('info', `re-entry cooldown: skipped ${cand.symbol} (last live close ${ban.why}; ${Math.floor(ban.minutesLeft / 60)}h${ban.minutesLeft % 60}m left)`, a.id); outcomes?.set(cand.mint, { decision: 'cooldown', reason: why }); return false; }
    }
  }
  const { pumpAgeFromEnv, resolvePumpAge } = await import('./pump-age');
  const paCfg = pumpAgeFromEnv(process.env);
  let pumpHours: number | null = null;
  if (paCfg && !kol) {
    const ev = await resolvePumpAge({
      mint: cand.mint,
      pairAddress: cand.pairAddress,
      pairCreatedAtMs: cand.ageHours != null ? Date.now() - cand.ageHours * 3_600_000 : null,
      price: cand.priceUsd,
    });
    if (ev?.block) {
      if (feedbackLogged(`pumpage:${cand.mint}`)) await log('info', `pump-age: skipped ${cand.symbol} (${ev.reason})`, a.id);
      outcomes?.set(cand.mint, { decision: 'too old', reason: ev.reason ?? 'late after pump' });
      return false;
    }
    if (ev?.downWeight && cand.composite < c.minCompositeScore + ev.scoreBump) {
      const why = ev.reason ?? 'late after pump';
      if (feedbackLogged(`pumpage:${cand.mint}`)) await log('info', `pump-age: down-weighted ${cand.symbol} score ${cand.composite.toFixed(3)} < ${(c.minCompositeScore + ev.scoreBump).toFixed(3)} (${why})`, a.id);
      outcomes?.set(cand.mint, { decision: 'down-weighted', reason: why });
      return false;
    }
    pumpHours = ev?.hoursSincePump ?? null;
  }
  // Live entry: rolling 5m volume must be at least LOW_VOL_5M_EXIT_USD (owner rule, default $1,500).
  if (c.mode === 'live' && a.isOperator) {
    const { lowVolConfig, entryVolumeOk } = await import('./low-volume-exit');
    const lv = lowVolConfig(process.env);
    if (lv) {
      const chk = entryVolumeOk(mem.pairFlow.get(cand.mint)?.m5Vol ?? null, kolCfg ? { ...lv, minUsd: kolCfg.minVol5mUsd } : lv);
      if (!chk.ok) {
        const why = chk.reason ?? '5m volume low';
        if (feedbackLogged(`m5vol:${cand.mint}`)) await log('info', `5m volume: skipped ${cand.symbol} (${why})`, a.id);
        outcomes?.set(cand.mint, { decision: '5m vol low', reason: why });
        return false;
      }
    }
  }
  // Momentum scalp (MOMENTUM_SCALP=dryrun): log what the scalp entry would do. Replay was negative OOS, so this never
  // changes live entries (see src/lib/momentum-scalp.ts).
  if (c.mode === 'live' && a.isOperator) {
    const { scalpConfig, scalpEntryCheck, describeScalpPlan } = await import('./momentum-scalp');
    const sc = scalpConfig(process.env);
    if (!kol && sc.mode !== 'off' && feedbackLogged(`scalp:${cand.mint}`)) {
      const flow = mem.pairFlow.get(cand.mint);
      let candles: Array<{ volume: number; open?: number; close?: number; high?: number; low?: number }> | null = null;
      if (cand.pairAddress) { try { candles = await (await import('./gecko')).fiveMinuteCandles(cand.pairAddress, 8); } catch { candles = null; } }
      const chk = scalpEntryCheck({ buys5m: flow?.buys, sells5m: flow?.sells, m5VolUsd: flow?.m5Vol, candles5m: candles }, sc);
      await log('info', `momentum scalp dryrun: ${cand.symbol} ${chk.pass ? `would enter (${describeScalpPlan(sc)})` : `no entry (${chk.reasons.join('; ')})`}`, a.id);
    }
  }
  // Live entry: 10m buy-side volume must clear min($MIN_BUY_VOLUME_10M_USD, MIN_BUY_VOLUME_10M_MCAP_PCT% of mcap).
  if (c.mode === 'live' && a.isOperator) {
    const { buyVolumeGateConfig, estimateBuyVolume10m } = await import('./buy-volume-gate');
    const bvCfg = kolCfg ? { minUsd: kolCfg.buyVolMinUsd, mcapPct: kolCfg.buyVolMcapPct } : buyVolumeGateConfig(process.env);
    if (bvCfg) {
      const flow = mem.pairFlow.get(cand.mint);
      let candles: Array<{ volume: number }> | null = null;
      if (cand.pairAddress) {
        try { candles = await (await import('./gecko')).fiveMinuteCandles(cand.pairAddress, 8); } catch { candles = null; }
      }
      const ev = estimateBuyVolume10m({
        m5VolUsd: flow?.m5Vol, m5Buys: flow?.buys, m5Sells: flow?.sells,
        candles5m: candles, marketCapUsd: cand.marketCap,
      }, bvCfg);
      if (!ev.pass) {
        const why = ev.reason ?? 'buy vol 10m below threshold';
        if (feedbackLogged(`buyvol:${cand.mint}`)) await log('info', `buy-volume: skipped ${cand.symbol} (${why}; ${ev.source})`, a.id);
        outcomes?.set(cand.mint, { decision: 'buy vol low', reason: why });
        return false;
      }
    }
  }
  const { equity, exposure, open: allOpen } = await accountEquity(a);
  // KOL add-on has its own slot(s): each mode only counts its own open positions against its own limit.
  const { isKolPosition } = await import('./exit-plan-store');
  const open = allOpen.filter((p) => (isKolPosition(p.id) ? kol : !kol));
  const maxOpen = kolCfg ? kolCfg.maxOpen : c.maxOpenPositions;
  const narrative = narrativeOf(cand.symbol, cand.name);
  const creator = audit.creator ?? null;
  let pre = portfolioCheck(open, { mint: cand.mint, sizeUsd: Number.MAX_SAFE_INTEGER, narrative, creator }, equity, { maxOpenPositions: maxOpen, maxTotalExposurePct: c.maxTotalExposurePct, maxPositionsPerCluster: c.maxPositionsPerCluster });
  if (!pre.allowed) { if (!pre.reasons.some((r) => r.startsWith('max open') || r.startsWith('duplicate'))) await log('info', `portfolio cap blocked ${cand.symbol}: ${pre.reasons.join('; ')}`, a.id); return false; }

  // A live operator entry spends real SOL, so it sizes strictly from the on-chain trading wallet.
  // Never fall back to the Postgres paper book: if the balance can't be read, skip the trade.
  const liveEntry = c.mode === 'live' && a.isOperator;
  const bal = await resolveSizingBalances({
    live: liveEntry,
    bookEquityUsd: equity,
    bookCashUsd: a.cashUsd,
    liveOpenValueUsd: allOpen.filter((p) => !p.simulated).reduce((s, p) => s + positionValue(p), 0),
    solPriceUsd: mem.solPrice,
    getLamports: () => operatorLamports(c),
  });
  if (!bal.ok) {
    await log('warn', `LIVE entry skipped ${cand.symbol}: on-chain wallet balance unavailable (${bal.reason}); not sizing from the paper book`, a.id);
    return false;
  }
  const sizingEquity = bal.equityUsd;
  const sizingCash = bal.cashUsd;
  if (liveEntry) {
    pre = portfolioCheck(open, { mint: cand.mint, sizeUsd: Number.MAX_SAFE_INTEGER, narrative, creator }, sizingEquity, { maxOpenPositions: maxOpen, maxTotalExposurePct: c.maxTotalExposurePct, maxPositionsPerCluster: c.maxPositionsPerCluster });
    if (!pre.allowed) return false;
  }

  let size = computePositionSize(
    { equityUsd: sizingEquity, cashUsd: sizingCash, openExposureUsd: exposure, cumulativePnl: a.realizedPnl, recoveryMode: a.recoveryMode },
    c,
  );
  if (a.isOperator && c.ownerPlan.enabled) {
    const solPrice = mem.solPrice || c.solPriceFallbackUsd;
    const o = computeOwnerTradeSize(
      { equityUsd: sizingEquity, cashUsd: sizingCash, solPriceUsd: solPrice, feeReserveSol: c.ownerPlan.feeReserveSol, minTradeUsd: c.minTradeUsd },
      c.ownerPlan.sizeTiers, c.ownerPlan.sizeStepUsd, c.ownerPlan.sizeIncrementUsd,
    );
    size = { sizeUsd: o.sizeUsd, tier: 1, multiplier: 1, notes: o.notes };
    if (a.recoveryMode && c.enableRecoveryMode) {
      const base = ownerRecoverySize(c.ownerPlan.sizeTiers);
      if (base !== null && size.sizeUsd > base) { size.sizeUsd = base; size.notes.push(`recovery mode: base tier $${base}`); }
    }
  }
  if (us && us.positionSizePct !== null) { size.sizeUsd = Math.min(sizeFromPct(us, sizingEquity, size.sizeUsd), sizingCash); size.notes.push(`${us.positionSizePct}% of equity (your setting)`); }
  const eqCap = capByEquityPct(size.sizeUsd, sizingEquity, c.maxPositionPctOfEquity);
  if (eqCap.capped) { size.sizeUsd = eqCap.sizeUsd; size.notes.push(`capped at ${c.maxPositionPctOfEquity}% of equity`); }
  if (size.sizeUsd > pre.maxSizeUsd) { size.sizeUsd = pre.maxSizeUsd; size.notes.push(`capped by ${c.maxTotalExposurePct}% portfolio exposure`); }
  if (liveEntry && size.sizeUsd > sizingCash) { size.sizeUsd = Math.floor(sizingCash * 100) / 100; size.notes.push('capped at on-chain wallet cash'); }
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
  // A scan the watchdog abandoned must never spend: re-check the fence right before the swap.
  if (scanGen !== undefined) assertCurrent(mem.scanFence, scanGen, 'scan');
  if (live && kol) kolPendingMints.add(cand.mint);
  if (live) {
    let r: { signature: string; outAmount: string };
    try {
      const { executeSwap, SOL_MINT } = await import('./executor');
      const lamports = BigInt(Math.floor((sizeUsd / mem.solPrice) * 1e9));
      r = await executeSwap(c, { inputMint: SOL_MINT, outputMint: cand.mint, amountRaw: lamports, slippageBps: st.slippageBps, priorityFeeLamports: st.priorityFeeLamports });
      await heal('ok', undefined, 'swap');
    } catch (e) {
      await heal(classifyError(e), (e as Error).message, 'swap');
      kolPendingMints.delete(cand.mint);
      await log('error', `LIVE buy failed ${cand.symbol}: ${(e as Error).message}`, a.id);
      return false;
    }
    // The swap landed: from here on we must record the position, never drop it.
    entryTx = r.signature;
    fees = (st.priorityFeeLamports / 1e9) * mem.solPrice;
    const got = await resolveLiveFillAmount(c, cand.mint, r.outAmount);
    if (got !== null) {
      tokenAmount = got;
    } else {
      tokenAmount = sizeUsd / cand.priceUsd;
      await log('warn', `LIVE buy ${cand.symbol}: could not read filled token amount (tx ${r.signature}); recording quote estimate ${tokenAmount.toPrecision(6)}`, a.id);
    }
    fillPrice = sizeUsd / tokenAmount;
  } else {
    // Realistic paper fill from a keyless Jupiter V2 /order quote (impact + feeBps incl. 50 bps new-token fee); model fallback.
    const chargeFee = await chargeOperatorFeeForAccount(a);
    const q = await simBuy({ mint: cand.mint, sizeUsd, mid: cand.priceUsd, solPriceUsd: (mem.solPrice || c.solPriceFallbackUsd), liquidityUsd: liquidity, fallbackImpact: c.slippageTolerance, ageHours: cand.ageHours, chargeOperatorFee: chargeFee });
    fillPrice = q.fillPrice;
    tokenAmount = sizeUsd / fillPrice;
    fees = simFeesUsd(sizeUsd, q.source === 'jupiter' ? q.feeBps : Math.max(c.simFeeBps, q.feeBps), st.priorityFeeLamports, (mem.solPrice || c.solPriceFallbackUsd));
  }

  const [created] = await prisma.$transaction([
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
  if (live && (kol || adaptiveExitsOn(c, a.isOperator))) {
    try { await createExitPlan(created, 'entry', { composite: cand.composite, liquidityUsd: liquidity ?? null, kol }); if (kol) kolPendingMints.delete(cand.mint); } catch (e) { await log('warn', `LIVE ${cand.symbol}: exit plan failed (${(e as Error).message}); fixed owner exits apply`, a.id); }
  }
  if (journalOn()) await journalEntryHook(a, c, cand, created, live, liquidity ?? null);
  if (live) {
    try {
      const { appendLiveTrade } = await import('./live-trade-log');
      const eqUsd = await liveEquityForLog(c, a.id);
      appendLiveTrade({
        type: 'buy', side: 'buy', token: cand.symbol, symbol: cand.symbol, mint: cand.mint,
        sizeUsd, price: fillPrice, entryPrice: fillPrice, signature: entryTx, equityUsd: eqUsd, simulated: false,
      });
    } catch { /* trade log must never block a fill */ }
  }
  return true;
}

/**
 * Tokens received by a live buy: swap outAmount with the mint's decimals, else an on-chain
 * balance read retried a few times (RPC lag right after a swap). Null if nothing usable.
 */
export async function resolveLiveFillAmount(c: Config, mint: string, outAmountRaw: string | undefined): Promise<number | null> {
  const { tokenBalanceRaw, mintDecimals } = await import('./executor');
  let decimals: number | null = await mintDecimals(c, mint).catch(() => null);
  const fromOut = liveFillTokenAmount(outAmountRaw, decimals, null);
  if (fromOut !== null) return fromOut;
  const tries = envNum('LIVE_FILL_READ_RETRIES', 4);
  for (let i = 0; i < tries; i++) {
    try {
      const b = await tokenBalanceRaw(c, mint);
      if (b.raw > 0n) { decimals = b.decimals; return liveFillTokenAmount(null, decimals, b.raw); }
    } catch { /* retry */ }
    await sleep(envNum('LIVE_FILL_READ_DELAY_MS', 1500));
  }
  return null;
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

async function presetLabTick(pairs: DexPair[], weights: Record<SignalName, number>, c: Config, scanGen?: number): Promise<string> {
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
        if (audit.passed && (await tryEnter(lab, cand, audit, { ...c, mode: 'simulation' }, scanGen))) n++;
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

// ─── Adaptive (self-directed) exits: live owner positions only ───────────────

export function adaptiveExitsOn(c: Config, isOperator: boolean): boolean {
  return c.mode === 'live' && isOperator && c.ownerPlan.enabled && c.ownerPlan.adaptiveExits;
}

/** Trade journal (TRADE_JOURNAL=on): the why at entry. Logging only; never throws into the trade path. */
const journalOn = () => ['on', 'true', '1'].includes((process.env.TRADE_JOURNAL ?? '').toLowerCase());
async function journalEntryHook(a: Account, c: Config, cand: ScanCandidate, p: Position, live: boolean, liquidity: number | null) {
  try {
    const { appendJournal, slippagePct } = await import('./trade-journal');
    const rec = live ? (await import('./exit-plan-store')).getPlanRecord(p.id) : null;
    const pc = mem.pairChange.get(cand.mint) ?? { h1: cand.priceChangeH1, h24: cand.priceChangeH24 };
    const reg = mem.regime;
    appendJournal({
      event: 'entry', v: 1, at: new Date().toISOString(), positionId: p.id, accountId: a.id, book: live ? 'live' : 'paper', labPreset: a.labPreset ?? null,
      symbol: cand.symbol, mint: cand.mint, score: cand.composite, threshold: c.minCompositeScore, weightSet: c.signalWeightSet ?? 'classic',
      liquidityWeights: c.signalWeightSet === 'liquidity' ? { ...activeLiquidityWeights() } : null,
      signals: { ...cand.signals }, terms: cand.terms ? { ...cand.terms } : null,
      mcapUsd: cand.marketCap, liquidityUsd: liquidity, volume24hUsd: cand.volume24h, ageHours: cand.ageHours,
      priceChangeH1: cand.priceChangeH1, priceChangeH24: cand.priceChangeH24 ?? null, volPctPerHour: volatilityPctPerHour(pc),
      regime: reg ? { label: regimeOf(reg), medianH1: reg.medianH1, breadth: reg.breadth, n: reg.n } : null,
      sizeUsd: p.sizeUsd, feesUsd: p.feesUsd, quotePrice: cand.priceUsd, fillPrice: p.entryPrice, entrySlippagePct: slippagePct('buy', cand.priceUsd, p.entryPrice),
      exitPlan: rec ? { ...rec.plan } : null,
    });
  } catch { /* journal must never block a fill */ }
}

/** Trade journal (TRADE_JOURNAL=on): the what at close. */
async function journalExitHook(p: Position, observed: number, reason: string, exitPrice: number, exitFees: number, pnlUsd: number, pnlPct: number) {
  try {
    const memLow = mem.lowest.get(p.id) ?? Infinity;
    const { appendJournal, slippagePct, excursions, takeLow } = await import('./trade-journal');
    const low = Math.min(takeLow(p.id) ?? Infinity, memLow);
    const ex = excursions(p.entryPrice, p.highestPrice, Number.isFinite(low) ? low : p.entryPrice, observed);
    appendJournal({
      event: 'exit', v: 1, at: new Date().toISOString(), positionId: p.id, book: p.simulated ? 'paper' : 'live', symbol: p.symbol,
      reason, holdMin: Math.round((Date.now() - p.openedAt.getTime()) / 600) / 100, mfePct: ex.mfePct, maePct: ex.maePct,
      feesUsd: p.feesUsd + exitFees, observedPrice: observed, exitPrice, exitSlippagePct: exitPrice > 0 ? slippagePct('sell', observed, exitPrice) : null,
      costUsd: p.sizeUsd + p.partialCostUsd, pnlUsd, pnlPct, partialsTaken: p.partialsTaken, partialPnlUsd: p.partialPnlUsd,
    });
  } catch { /* journal must never block a close */ }
}

/** Compute, persist and log a position's exit plan. */
async function createExitPlan(p: Position, source: 'entry' | 'recomputed', extra: { composite?: number; liquidityUsd?: number | null; currentPrice?: number; kol?: boolean } = {}) {
  const store = await import('./exit-plan-store');
  if (extra.kol || store.isKolPosition(p.id)) {
    const km = await import('./kol-mode');
    const kplan = km.kolExitPlan(km.kolConfig(process.env), extra.composite ?? p.compositeScore, extra.liquidityUsd ?? mem.liquidity.get(p.mint) ?? null);
    planAnnounced.add(p.id);
    store.savePlanRecord({ positionId: p.id, mint: p.mint, symbol: p.symbol, plan: kplan, source, computedAt: new Date().toISOString(), maePct: 0, mode: 'kol' });
    await log('info', `LIVE exit plan ${p.symbol} (KOL mode): take profit +${kplan.takeProfitPct}% (sell 100%) | stop -${kplan.stopLossPct}% | stale ${kplan.stalePositionMinutes}m ±${kplan.staleBandPct}% | $${km.kolConfig(process.env).minVol5mUsd} 5m-volume exit`, p.accountId);
    return kplan;
  }
  const currentPnlPct = source === 'recomputed' && extra.currentPrice ? (extra.currentPrice / p.entryPrice - 1) * 100 : undefined;
  let plan = computeExitPlan({
    priceChange: mem.pairChange.get(p.mint) ?? null,
    composite: extra.composite ?? p.compositeScore,
    liquidityUsd: extra.liquidityUsd ?? mem.liquidity.get(p.mint) ?? null,
    regime: mem.regime, history: store.pastTrades(), currentPnlPct,
  });
  const { pumpAgeFromEnv, peekPumpAge, applyImpulseExitBias } = await import('./pump-age');
  const pa = pumpAgeFromEnv(process.env);
  if (pa) {
    const ev = peekPumpAge(p.mint);
    const hoursAtEntry = ev?.pumpStartMs != null ? (p.openedAt.getTime() - ev.pumpStartMs) / 3_600_000 : ev?.hoursSincePump ?? null;
    plan = applyImpulseExitBias(plan, hoursAtEntry, pa);
  }
  if (!planWithinBounds(plan)) throw new Error(`plan outside hard bounds: ${describePlan(plan)}`);
  const lowSeen = mem.lowest.get(p.id);
  planAnnounced.add(p.id);
  store.savePlanRecord({ positionId: p.id, mint: p.mint, symbol: p.symbol, plan, source, computedAt: new Date().toISOString(), maePct: lowSeen ? Math.max(0, (1 - lowSeen / p.entryPrice) * 100) : 0 });
  await log('info', `LIVE exit plan ${p.symbol} (${source === 'entry' ? 'chosen at entry' : 'recomputed on restart'}): ${describePlan(plan)}`, p.accountId);
  return plan;
}

/**
 * The exit plan for a live owner position: stored plan, else recompute (older position, e.g. after a restart).
 * Recompute waits for the first scan (regime) and a price-change read, so it isn't built from nothing;
 * until then the fixed owner exits still protect the position.
 */
async function exitPlanFor(p: Position, price: number) {
  const store = await import('./exit-plan-store');
  const rec = store.getPlanRecord(p.id);
  if (rec) {
    if (!planAnnounced.has(p.id)) { planAnnounced.add(p.id); await log('info', `LIVE exit plan ${p.symbol} (kept from ${rec.source === 'entry' ? 'entry' : 'recompute'} at ${rec.computedAt}): ${describePlan(rec.plan)}`, p.accountId); }
    return rec.plan;
  }
  if (!mem.regime || !mem.pairChange.has(p.mint)) return null;
  return createExitPlan(p, 'recomputed', { currentPrice: price });
}

const planWarned = new Set<string>();
/** Plans already logged by this process (a stored plan is announced once after a restart). */
const planAnnounced = new Set<string>();

async function evaluatePosition(p: Position, price: number, killSwitch: boolean, serverCfg: Config) {
  return inPositionWallet(p.id, p.mint, () => evaluatePositionInner(p, price, killSwitch, serverCfg));
}
async function evaluatePositionInner(p: Position, price: number, killSwitch: boolean, serverCfg: Config) {
  const acct = await prisma.account.findUnique({ where: { id: p.accountId }, select: { isOperator: true } });
  let c = applyOwnerPlan(effectiveConfig(serverCfg, await accountSettings(p.accountId, serverCfg)), !!acct?.isOperator);
  if (!p.simulated && adaptiveExitsOn(c, !!acct?.isOperator)) {
    try {
      const plan = await exitPlanFor(p, price);
      if (plan) {
        const km = await import('./kol-mode');
        c = km.isKolPlan(plan) ? (km.kolPlanValid(plan) ? { ...c, ...km.kolOverrides(plan) } : c) : { ...c, ...planOverrides(plan) };
      }
    } catch (e) {
      if (!planWarned.has(p.id)) { planWarned.add(p.id); await log('warn', `LIVE ${p.symbol}: exit plan unavailable (${(e as Error).message}); fixed owner exits apply`, p.accountId); }
    }
    const low = Math.min(mem.lowest.get(p.id) ?? price, price);
    mem.lowest.set(p.id, low);
    void import('./exit-plan-store').then((s) => s.noteDrawdown(p.id, Math.max(0, (1 - low / p.entryPrice) * 100))).catch(() => undefined);
  }
  if (journalOn()) void import('./trade-journal').then((j) => j.noteLow(p.id, price)).catch(() => undefined);
  const highest = Math.max(p.highestPrice, price);
  if (price !== p.lastPrice || highest !== p.highestPrice) await prisma.position.update({ where: { id: p.id }, data: { lastPrice: price, highestPrice: highest } });
  // Fast exit on a dev dump or smart-money / whale exit (on-chain flow; WHALE_FAST_EXIT=off disables).
  // Dev-dump / whale-exit fast exit: an EXIT signal for an open position only, never a buy trigger.
  const flow = killSwitch ? null : flowExitFor(p.mint);
  if (flow && !p.simulated) await log('warn', `LIVE ${p.symbol}: ${flow === 'dev_exit' ? 'dev wallet dumping' : 'tracked whales / smart money exiting'} — fast exit`, p.accountId);
  // Holder-sell exit (HOLDER_SELL_EXIT=on, live only): creator or a top-10 holder sold >= 20% of its bag or >= 1% of supply.
  let holderReason: string | null = null;
  if (!p.simulated && !killSwitch && !flow && process.env.HOLDER_SELL_EXIT) {
    try {
      const hw = await import('./holder-watch');
      if (hw.holderSellOn()) {
        const { getOperatorPublicKey } = await import('./wallet');
        void hw.pollHolders({ id: p.id, mint: p.mint, creator: p.creator }, getOperatorPublicKey() ?? null, (m) => void log('info', `LIVE ${p.symbol}: ${m}`, p.accountId));
        const hit = hw.takeHolderExit(p.id);
        if (hit) {
          holderReason = hit.reason;
          await log('warn', `LIVE ${p.symbol}: ${hit.reason === 'dev_exit' ? 'creator wallet' : 'top-10 holder'} ${hit.wallet.slice(0, 6)}… sold ${(hit.soldFrac * 100).toFixed(0)}% of its holding (${hit.soldSupplyPct}% of supply) since entry — fast exit`, p.accountId);
        }
      }
    } catch { /* holder watch must never block the monitor */ }
  }
  const reason = killSwitch ? 'kill_switch' : flow ?? holderReason ?? exitDecision({ entryPrice: p.entryPrice, highestPrice: highest, openedAt: p.openedAt }, price, { ...c });
  if (reason) { await closePosition(p.id, price, reason); return; }
  const partial = partialTakeProfit(p, price, c.tpLadder, p.partialsTaken, c.takeProfitPct);
  if (partial) await partialClose(p.id, price, partial.fraction, partial.rung, partial.gainPct);
}

const fastChecks = new Map<string, number>();
/** Called from the Helius WebSocket when a position's pool changes: re-price that token now. */
function onPoolChange(mint: string, signature?: string) {
  if (fastPriceOn()) {
    // Logs mode: keep the latest swap per mint (trailing debounce) so a burst of swaps still ends with a check.
    fastDebounce ??= new TrailingDebounce<string | undefined>(Number(process.env.WS_EXIT_DEBOUNCE_MS ?? 1000), (m, sig) => void fastRecheck(m, sig));
    fastDebounce.push(mint, signature);
    return;
  }
  const now = Date.now();
  if (now - (fastChecks.get(mint) ?? 0) < Number(process.env.WS_EXIT_DEBOUNCE_MS ?? 1000)) return;
  fastChecks.set(mint, now);
  void fastRecheck(mint);
}
let fastDebounce: TrailingDebounce<string | undefined> | null = null;
const fastStats = { onchain: 0, rejected: 0, fallback: 0 };
export const fastPriceStats = () => ({ ...fastStats });
/** Heartbeat suffix when FAST_PRICE_WS=on: WebSocket health and how often the on-chain price was used. */
async function fastHb(): Promise<string> {
  if (!fastPriceOn()) return '';
  const w = (await import('./helius')).wsStatus();
  return `; fast price: ws ${w.connected ? 'up' : 'down'} (${w.subscriptions} subs, ${w.events} events, last msg ${w.lastMessageAgoSec ?? '-'}s ago, ${w.staleReconnects} stale reconnects), on-chain ${fastStats.onchain} / rejected ${fastStats.rejected} / fallback ${fastStats.fallback}`;
}

async function fastRecheck(mint: string, signature?: string) {
  try {
    const c = getConfig();
    let px: number | undefined;
    if (signature && fastPriceOn()) {
      // On-chain price from the swap itself (bounded by a deadline); Jupiter Price is the fallback.
      const fp = fastPriceParams();
      const onchain = await withDeadline(fastPriceFromSignature(signature, mint, mem.solPrice), fp.txTimeoutMs * 2 + fp.retryDelayMs + 1000, 'fast price').catch(() => null);
      if (onchain && acceptFastPrice(onchain, mem.prices.get(mint), fp.maxJumpPct)) { px = onchain; fastStats.onchain++; }
      else if (onchain) fastStats.rejected++;
    }
    if (!px) { px = (await fetchFastPrices([mint])).get(mint); if (px && signature) fastStats.fallback++; }
    if (!px) return;
    setPrice(mint, px);
    const st = await getEngineState();
    const open = await prisma.position.findMany({ where: { status: 'open', mint } });
    await mapLimit(open, 4, (p) => evaluatePosition(p, px!, st.killSwitch, c));
  } catch { /* polling is the backstop */ }
}

export async function monitorTick(): Promise<void> {
  if (mem.monitoring) return;
  mem.monitoring = true;
  const gen = nextGen(mem.monitorFence);
  const started = Date.now();
  try {
    await withDeadline(monitorTickInner(gen), monitorDeadlineMs(), 'monitor tick');
    mem.lastMonitorDoneAt = Date.now();
  } catch (e) {
    if (e instanceof DeadlineError) {
      nextGen(mem.monitorFence);
      await log('warn', `watchdog: monitor stuck ${Math.round((Date.now() - started) / 1000)}s at stage "${mem.monitorStage}" — abandoned, monitoring resumes next tick`).catch(() => undefined);
    }
  } finally {
    mem.monitoring = false;
  }
}

async function monitorTickInner(gen: number): Promise<void> {
  const c = getConfig();
  const stage = (s: string) => { if (mem.monitorFence.gen === gen) mem.monitorStage = s; };
  try {
    stage('engine state');
    const st = await getEngineState();
    stage('open positions');
    const open = await prisma.position.findMany({ where: { status: 'open' } });
    // Keep Helius WebSocket pool subscriptions in sync with open positions (fast exits).
    const { syncPoolSubscriptions } = await import('./helius');
    syncPoolSubscriptions(new Map(open.filter((p) => p.pairAddress).map((p) => [p.pairAddress as string, p.mint])), (m, sig) => onPoolChange(m, sig));
    if (!open.length) {
      void import('./profit-sweep').then((m) => m.maybeRunProfitSweep()).catch(() => undefined);
      return;
    }
    const mints = [...new Set(open.map((p) => p.mint))];
    stage('jupiter prices');
    const fast = await fetchFastPrices(mints);
    for (const [m, v] of fast) setPrice(m, v);
    const missing = mints.filter((m) => !fast.has(m));
    const needLiq = mints.filter((m) => !mem.liquidity.has(m));
    if (missing.length || needLiq.length || mem.monitorTicks % 10 === 0) {
      try {
        stage('dexscreener prices');
        const pairs = await fetchPairsForMints([...new Set([...missing, ...needLiq, ...(mem.monitorTicks % 10 === 0 ? mints : [])])]);
        for (const [m, p] of pairs) {
          if (!fast.has(m) && Number(p.priceUsd) > 0) setPrice(m, Number(p.priceUsd));
          if (p.liquidity?.usd) mem.liquidity.set(m, p.liquidity.usd);
          if (p.priceChange) mem.pairChange.set(m, p.priceChange);
          notePairFlow(m, p);
        }
      } catch (e) {
        await log('warn', `price refresh failed: ${(e as Error).message}`);
      }
    }
    mem.monitorTicks++;
    // Evaluate every open position concurrently (bounded so live sells don't flood the RPC).
    // A live position whose price hasn't refreshed in LIVE_STALE_PRICE_MS (default 2 min) is flying blind:
    // the stop-loss can't fire on a frozen price, so attempt a protective exit.
    const now = Date.now();
    const staleMs = envNum('LIVE_STALE_PRICE_MS', 120_000);
    for (const m of mints) if (!mem.priceAt.has(m)) mem.priceAt.set(m, now);
    stage('evaluate positions');
    await mapLimit(open, Number(process.env.EXIT_CONCURRENCY ?? 8), async (p) => {
      if (!p.simulated && !st.killSwitch && isPriceStale(mem.priceAt.get(p.mint), now, staleMs)) {
        if (!mem.sellFailures.has(p.id)) await log('warn', `LIVE ${p.symbol}: price stale for ${Math.round((now - (mem.priceAt.get(p.mint) ?? now)) / 1000)}s — protective exit`, p.accountId);
        return closePosition(p.id, p.lastPrice, 'stale_price');
      }
      const px = mem.prices.get(p.mint) ?? p.lastPrice;
      if (!p.simulated && c.mode === 'live' && !st.killSwitch && await checkLowVolume(p, px)) return;
      if (!p.simulated && c.mode === 'live' && !st.killSwitch && await checkVolumeFade(p, px)) return;
      return evaluatePosition(p, px, st.killSwitch, c);
    });
  } catch (e) {
    await log('error', `monitorTick error: ${(e as Error).message}`);
  } finally {
    stage('idle');
  }
}

/** Hard 5m volume floor (owner rule): rolling 5m volume < LOW_VOL_5M_EXIT_USD after the entry grace -> sell all. */
async function checkLowVolume(p: Position, price: number): Promise<boolean> {
  const { lowVolConfig, lowVolumeExitReason } = await import('./low-volume-exit');
  const lv = lowVolConfig(process.env);
  if (!lv) return false;
  const flow = mem.pairFlow.get(p.mint);
  if (!flow) return false;
  const { isKolPosition } = await import('./exit-plan-store');
  const lvFor = isKolPosition(p.id) ? { ...lv, minUsd: (await import('./kol-mode')).kolConfig(process.env).minVol5mUsd } : lv;
  const why = lowVolumeExitReason({ m5VolUsd: flow.m5Vol, openedAtMs: p.openedAt.getTime(), sampleAtMs: flow.at, nowMs: Date.now() }, lvFor);
  if (!why) return false;
  const gainPct = (price / p.entryPrice - 1) * 100;
  await log('warn', `LIVE ${p.symbol}: LOW 5m VOLUME exit (${why}; P&L ${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%)`, p.accountId);
  mem.fade.delete(p.id);
  await closePosition(p.id, price, 'low_volume_5m');
  return true;
}

/**
 * Volume-fade exit (live owner positions): volume/buyers dried up for FADE_MINUTES while the trade isn't working
 * -> sell to free the slot. Checked once per fresh DexScreener sample (~30 s). Returns true if it sold.
 */
async function checkVolumeFade(p: Position, price: number): Promise<boolean> {
  const { fadeFromEnv, fadeReason, stepFade } = await import('./volume-fade');
  const fp = fadeFromEnv(process.env);
  if (!fp) return false;
  const flow = mem.pairFlow.get(p.mint);
  const prev = mem.fade.get(p.id) ?? { since: null, reason: null, lastAt: 0 };
  if (!flow || flow.at === prev.lastAt || Date.now() - flow.at > 120_000) return false;
  if (p.partialsTaken > 0) { mem.fade.delete(p.id); return false; } // winner already paid: the trail manages it
  const store = await import('./exit-plan-store');
  const rec = store.getPlanRecord(p.id);
  let baseline = rec?.volBaselineM5Usd;
  if (!(baseline && baseline > 0)) {
    baseline = flow.h1Vol / 12; // ~ the hour before entry for a new position (the first sample lands within ~30 s)
    if (!(baseline > 0)) return false;
    if (rec) store.savePlanRecord({ ...rec, volBaselineM5Usd: baseline });
    await log('info', `LIVE volume-fade armed ${p.symbol}: baseline $${Math.round(baseline)}/5m${rec?.source === 'entry' && Date.now() - p.openedAt.getTime() > 5 * 60_000 ? ' (set after a restart from the current hour)' : ''}; exit if 5m volume < ${Math.round(fp.volFrac * 100)}% of it (or buys < ${Math.round(fp.maxBuyShare * 100)}% on < ${Math.round(fp.sellSideVolFrac * 100)}% volume) for ${fp.minutes} min while below +${fp.maxGainPct}%`, p.accountId);
  }
  const why = fadeReason({ m5VolUsd: flow.m5Vol, buys: flow.buys, sells: flow.sells }, baseline, fp);
  const gainPct = (price / p.entryPrice - 1) * 100;
  const r = stepFade(prev, why, flow.at, { openedAt: p.openedAt.getTime(), gainPct }, fp);
  if (why && prev.since === null) await log('info', `LIVE ${p.symbol}: volume fading (${why}) — exits in ${fp.minutes} min unless it picks up`, p.accountId);
  if (!why && prev.since !== null) await log('info', `LIVE ${p.symbol}: volume back (5m $${Math.round(flow.m5Vol)}), fade clock reset`, p.accountId);
  mem.fade.set(p.id, { ...r.st, lastAt: flow.at });
  if (!r.fire) return false;
  await log('warn', `LIVE ${p.symbol}: VOLUME FADE exit after ${r.heldFadedMin.toFixed(0)} min (${why}; P&L ${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%) — freeing the slot`, p.accountId);
  mem.fade.delete(p.id);
  await closePosition(p.id, price, 'volume_fade');
  return true;
}

/** Sell `fraction` of the remaining position at a take-profit rung; the rest keeps running. */
export async function partialClose(positionId: string, price: number, fraction: number, rung: number, gainPct: number) {
  return inPositionWallet(positionId, null, () => partialCloseLocked(positionId, price, fraction, rung, gainPct));
}
async function partialCloseLocked(positionId: string, price: number, fraction: number, rung: number, gainPct: number) {
  if (!mem.selling.tryAcquire(positionId)) return; // another path is already selling this position
  try { await partialCloseInner(positionId, price, fraction, rung, gainPct); } finally { mem.selling.release(positionId); }
}

async function partialCloseInner(positionId: string, price: number, fraction: number, rung: number, gainPct: number) {
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
      await heal(classifyError(e), (e as Error).message, 'swap');
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
      const eqUsd = await liveEquityForLog(c, p.accountId);
      appendLiveTrade({
        type: 'sell', side: 'sell', token: p.symbol, symbol: p.symbol, mint: p.mint,
        sizeUsd: costPortion, price, exitPrice: price, pnlUsd: pnl, signature: tx, equityUsd: eqUsd,
        reason: `partial_tp${rung}`, simulated: false,
      });
    } catch { /* trade log must never block a fill */ }
  }
}

/** Mints whose KOL buy is in flight (before the plan record marks the position as KOL). */
const kolPendingMints = new Set<string>();
/** Run `fn` with the wallet that holds this position (KOL add-on wallet or the operator wallet). */
async function inPositionWallet<T>(positionId: string, mint: string | null, fn: () => Promise<T>): Promise<T> {
  const [{ isKolPosition }, w] = await Promise.all([import('./exit-plan-store'), import('./wallet')]);
  if (typeof w.withKolWallet !== 'function' || typeof w.activeWalletName !== 'function' || w.activeWalletName() === 'kol') return fn();
  if (isKolPosition(positionId) || (mint !== null && kolPendingMints.has(mint))) return w.withKolWallet(fn);
  return fn();
}

export async function closePosition(positionId: string, price: number, reason: string) {
  // Only look the mint up while a KOL buy is in flight (its plan record not written yet).
  const mint = kolPendingMints.size ? (await prisma.position.findUnique({ where: { id: positionId }, select: { mint: true } }))?.mint ?? null : null;
  return inPositionWallet(positionId, mint, () => closePositionLocked(positionId, price, reason));
}
async function closePositionLocked(positionId: string, price: number, reason: string) {
  if (!mem.selling.tryAcquire(positionId)) return; // another path is already selling this position
  try { await closePositionInner(positionId, price, reason); } finally { mem.selling.release(positionId); }
}

async function closePositionInner(positionId: string, price: number, reason: string) {
  const c = getConfig();
  const p = await prisma.position.findUnique({ where: { id: positionId } });
  if (!p || p.status !== 'open') return;
  const a = await prisma.account.findUniqueOrThrow({ where: { id: p.accountId } });
  const st = await getEngineState();
  const live = !p.simulated;
  let proceeds: number, exitFees: number, exitPrice: number, exitTx: string | null = null;

  if (live) {
    const prev = mem.sellFailures.get(p.id);
    if (prev && Date.now() < prev.nextAttemptAt) return; // backing off after a failed sell
    const attempt = prev?.failures ?? 0;
    try {
      const { executeSwap, tokenBalanceRaw, SOL_MINT } = await import('./executor');
      let bal = await tokenBalanceRaw(c, p.mint);
      if (bal.raw === 0n) { await sleep(envNum('LIVE_ZERO_RECHECK_MS', 2000)); bal = await tokenBalanceRaw(c, p.mint); }
      if (bal.raw === 0n) {
        // Tokens are gone from the wallet (sold elsewhere, rugged/burned): close the book entry at zero.
        await log('warn', `LIVE ${p.symbol}: wallet holds 0 tokens (confirmed twice) — closing as external_zero (was ${reason})`, a.id);
        reason = 'external_zero';
        proceeds = 0; exitPrice = 0; exitFees = 0;
      } else {
        const slippageBps = exitSlippageBps(reason, attempt, st.slippageBps, parseLadder(process.env.EXIT_SLIPPAGE_LADDER_BPS));
        const r = await executeSwap(c, { inputMint: p.mint, outputMint: SOL_MINT, amountRaw: bal.raw, slippageBps, priorityFeeLamports: st.priorityFeeLamports });
        proceeds = (Number(r.outAmount) / 1e9) * mem.solPrice;
        exitPrice = safeExitPrice(proceeds, Number(bal.raw) / 10 ** bal.decimals, price);
        exitFees = (st.priorityFeeLamports / 1e9) * mem.solPrice;
        exitTx = r.signature;
        await heal('ok', undefined, 'swap');
      }
      mem.sellFailures.delete(p.id);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const next = recordSellFailure(prev, msg);
      mem.sellFailures.set(p.id, next);
      const maxFail = envNum('LIVE_SELL_MAX_FAILURES', 8);
      const maxNoRoute = envNum('LIVE_SELL_MAX_NO_ROUTE', 4);
      if (!shouldWriteOff(next, maxFail, maxNoRoute)) {
        await log('warn', `LIVE sell failed ${p.symbol} (${reason}) attempt ${next.failures}/${maxFail}: ${msg} — retry in ${Math.round((next.nextAttemptAt - Date.now()) / 1000)}s at wider slippage`, a.id);
        return;
      }
      // Stuck: free the single position slot so the bot can keep trading. Any tokens stay in the wallet.
      await log('warn', `LIVE sell STUCK ${p.symbol}: ${next.failures} failed attempts (${next.noRouteFailures} no-route), last: ${msg} — writing off in the book to free the slot; tokens (if any) remain in the wallet`, a.id);
      mem.sellFailures.delete(p.id);
      reason = 'stuck_written_off';
      proceeds = 0; exitPrice = 0; exitFees = 0;
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

  if (journalOn()) await journalExitHook(p, price, reason, exitPrice, exitFees, pnlUsd, pnlPct);

  // Account bookkeeping, drawdown & recovery mode.
  const updated = await prisma.account.update({ where: { id: a.id }, data: { cashUsd: { increment: proceeds - exitFees }, realizedPnl: { increment: remainderPnl }, consecutiveWins: won ? { increment: 1 } : 0, consecutiveLosses: won ? 0 : { increment: 1 } } });
  // A live operator's drawdown/recovery is judged on the on-chain wallet by sampleLiveEquity (live-drawdown.ts),
  // never on this account's ~$10k paper peak (which made both checks dead for a ~$10 wallet).
  const liveOperatorBook = c.mode === 'live' && a.isOperator;
  const { equity } = await accountEquity(updated);
  const peak = Math.max(updated.peakEquity, equity);
  const dd = liveOperatorBook ? 0 : peak > 0 ? ((peak - equity) / peak) * 100 : 0;
  const data: Partial<Account> = liveOperatorBook ? {} : { peakEquity: peak };
  if (c.enableRecoveryMode && !updated.recoveryMode && dd >= c.maxDrawdownPct / 2) { data.recoveryMode = true; await log('warn', `recovery mode ON (drawdown ${dd.toFixed(1)}%) — sizes x${c.recoveryMultiplier}`, a.id); }
  if (updated.recoveryMode && updated.consecutiveWins >= c.recoveryExitWins) { data.recoveryMode = false; await log('info', `recovery mode OFF after ${updated.consecutiveWins} wins`, a.id); }
  // Live closes on the operator count only real trades toward the loss streak (not the paper book's history).
  const streak = live && a.isOperator ? await liveLossStreak(a.id) : updated.consecutiveLosses;
  if (!won && lossStreakPause(streak, c.maxConsecutiveLosses) && !updated.paused) { data.paused = true; data.pauseReason = `${streak} losses in a row (MAX_CONSECUTIVE_LOSSES=${c.maxConsecutiveLosses})`; await log('warn', `account AUTO-PAUSED: ${data.pauseReason}`, a.id); }
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
      const store = await import('./exit-plan-store');
      const low = Math.min(mem.lowest.get(p.id) ?? price, price);
      store.noteDrawdown(p.id, Math.max(0, (1 - low / p.entryPrice) * 100));
      if (process.env.HOLDER_SELL_EXIT) void import('./holder-watch').then((h) => h.forgetPosition(p.id)).catch(() => undefined);
      store.recordOutcome(p.id, { mfePct: Math.max(0, (Math.max(p.highestPrice, price) / p.entryPrice - 1) * 100), pnlPct, reason });
      mem.lowest.delete(p.id);
    } catch { /* learning data must never block a close */ }
  }
  if (live) {
    try {
      const { appendLiveTrade } = await import('./live-trade-log');
      const eqUsd = await liveEquityForLog(c, a.id);
      appendLiveTrade({
        type: 'sell', side: 'sell', token: p.symbol, symbol: p.symbol, mint: p.mint,
        sizeUsd: p.sizeUsd + p.partialCostUsd, price: exitPrice, entryPrice: p.entryPrice, exitPrice,
        pnlUsd, pnlPct, signature: exitTx, equityUsd: eqUsd, reason, simulated: false,
      });
    } catch { /* trade log must never block a fill */ }
  }
  // Reclaim the token account's rent once the wallet holds none of this coin (best-effort, never blocks the close).
  if (live && (exitTx || reason === 'external_zero') && process.env.RECLAIM_TOKEN_RENT !== 'off') {
    setTimeout(() => void reclaimRent(p.mint, p.symbol, a.id), envNum('RECLAIM_RENT_DELAY_MS', 15_000));
  }
  if (a.isOperator) void import('./profit-sweep').then((m) => m.maybeRunProfitSweep()).catch(() => undefined);
}

async function reclaimRent(mint: string, symbol: string, accountId: string) {
  try {
    const stillOpen = await prisma.position.count({ where: { status: 'open', mint, simulated: false } });
    if (stillOpen) return;
    const [{ connection }, { loadTradingKeypair }, { closeEmptyTokenAccounts }] = await Promise.all([import('./executor'), import('./wallet'), import('./rent-reclaim')]);
    const { withBotTx } = await import('./live-drawdown');
    const r = await withBotTx(() => closeEmptyTokenAccounts(connection(getConfig()), loadTradingKeypair(), mint));
    if (r.closed) await log('info', `LIVE ${symbol}: closed ${r.closed} empty token account(s), rent returned to wallet (tx ${r.signature})`, accountId);
    else if (r.skipped === 'balance remains') await log('warn', `LIVE ${symbol}: token account not closed — balance remains`, accountId);
  } catch (e) {
    await log('warn', `LIVE ${symbol}: rent reclaim failed: ${(e as Error).message}`, accountId);
  }
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
  await log('info', `engine start: mode=${c.mode.toUpperCase()} preset=${c.preset} aggression=${c.aggression} scan every ${c.tradeFrequencySeconds}s, monitor every ${c.positionMonitorSeconds}s; owner plan ${plan.enabled ? `on (${plan.maxOpenPositions} pos, SL ${plan.stopLossPct}% / TP ${plan.takeProfitPct}%${plan.tpLadder.length ? `, partials ${plan.tpLadder.map((r) => `${r.sellPct}%@+${r.gainPct}%`).join(' ')}` : ''}${plan.breakEvenTriggerPct !== null ? `, BE after +${plan.breakEvenTriggerPct}%` : ''}${plan.trailingStopPct !== null ? `, trail ${plan.trailingStopPct}% armed +${plan.trailingArmPct ?? 0}%` : ''}, sweep ${plan.sweepArmed ? 'armed' : 'paused'})` : 'off'}`);
  if (adaptiveExitsOn(c, true)) await log('info', `adaptive exits ON for live owner trades: per-trade plan from volatility, score, liquidity, regime and past trades; hard bounds SL ${HARD_BOUNDS.minStopPct}-${HARD_BOUNDS.maxStopPct}%, partial +${HARD_BOUNDS.minPartialPct}-${HARD_BOUNDS.maxPartialPct}% selling ${HARD_BOUNDS.minPartialSellPct}-${HARD_BOUNDS.maxPartialSellPct}%, trail ${HARD_BOUNDS.minTrailPct}-${HARD_BOUNDS.maxTrailPct}%, final <= +${HARD_BOUNDS.maxFinalPct}%, daily loss stop ${plan.maxDailyLossPct}%; fixed owner exits are the fallback`);
  {
    const { pumpAgeFromEnv, describePumpAge } = await import('./pump-age');
    const pa = pumpAgeFromEnv(process.env);
    await log('info', pa ? describePumpAge(pa) : 'pump-age filter: off');
  }
  if (process.env.ENGINE_DISABLED === 'true') { mem.lastScanSummary = 'engine disabled (ENGINE_DISABLED=true)'; return; }
  mem.timers.push(setInterval(() => void scanTick(), c.tradeFrequencySeconds * 1000));
  mem.timers.push(setInterval(() => void monitorTick(), c.positionMonitorSeconds * 1000));
  // Heartbeat: proves both loops are alive (a silent log used to be the only symptom of a hang).
  const hbMin = envNum('HEARTBEAT_MINUTES', 5);
  const liveHb = async () => (c.mode === 'live' ? `; ${(await import('./live-drawdown')).describeLive((await import('./live-drawdown')).loadState())}` : '');
  if (hbMin > 0) mem.timers.push(setInterval(() => void liveHb().catch(() => '').then(async (extra) => log('info', `heartbeat: last scan ${ageSec(mem.lastScanDoneAt) ?? 'never'}s ago (${mem.scanning ? `running: ${mem.scanStage}` : 'idle'}), last monitor ${ageSec(mem.lastMonitorDoneAt) ?? 'never'}s ago (${mem.monitoring ? `running: ${mem.monitorStage}` : 'idle'})${extra}${await fastHb()}`)).catch(() => undefined), hbMin * 60_000));
  // Suspend detector: the box can be paused while idle; the process then sees a wall-clock jump that its
  // monotonic clock (and ps start time) never sees. Log it so a silent gap isn't mistaken for a hang or restart.
  {
    const { suspendGapMs } = await import('./watchdog');
    let last = { wall: Date.now(), mono: performance.now() };
    mem.timers.push(setInterval(() => {
      const now = { wall: Date.now(), mono: performance.now() };
      const gap = suspendGapMs(last, now);
      last = now;
      if (gap > 0) void log('warn', `box was suspended ~${Math.round(gap / 1000)}s (wall clock jumped, process clock did not): scans and stop checks were paused meanwhile${c.mode === 'live' ? '; open positions are re-checked now' : ''}`).catch(() => undefined);
    }, 10_000));
  }
  if (c.mode === 'live') {
    setTimeout(() => void sampleLiveEquity(), 8000); // after the first scan has a SOL price
    mem.timers.push(setInterval(() => void sampleLiveEquity(), envNum('LIVE_EQUITY_SAMPLE_SECONDS', 60) * 1000));
  }
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
