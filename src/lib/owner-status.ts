/**
 * Assembles the owner dashboard payload.
 *
 * Priority: box Postgres (operator account) + live-trades.jsonl + on-chain
 * balance, else the last snapshot the worker pushed to Vercel, else on-chain
 * alone (Helius). Never invents trades.
 */
import { isDemo } from './demo';
import { getConfig } from './config';
import { OWNER_TRADING_WALLET, parseOwnerPlanConfig, tradeSizeForEquity, type OwnerPlanStatusView } from './owner-plan';
import { readLiveTrades } from './live-trades';
import { readOnchainWallet } from './owner-onchain';
import { loadOwnerState, snapshotAgeMs } from './owner-store';
import { EMPTY_HALT, type HaltState } from './owner-halt';
import {
  curveFromClosed, enrichPosition, feedFromLiveEvents, isolateLiveWatch, liveWatchFromAccountStatus, mergeFeed, sumTodayPnl, winLoss,
  type LiveWatchFeedItem, type LiveWatchModel, type LiveWatchPosition,
} from './live-watch';
import { buildPublicBooks, booksFromMaybeMixed, mergeRecorded, recordedFromClosedPositions, recordedFromLiveEvents, type PublicLiveStats } from './public-live';
import { solscanAccountUrl, solscanTxUrl } from './approvals';
import { resolveOwnerWallet } from './owner-auth';

export interface OwnerExtras {
  tradingWallet: string;
  payoutWallet: string | null;
  ownerWallet: string;
  plan: OwnerPlanStatusView | null;
  engine: {
    mode: 'simulation' | 'live';
    liveBlockedReason: string | null;
    killSwitch: boolean;
    killReason: string | null;
    lastScanAt: string | null;
    scanCount: number | null;
    lastScanSummary: string | null;
    withinSchedule: boolean | null;
    brainProvider: string | null;
  };
  onchain: Awaited<ReturnType<typeof readOnchainWallet>> | null;
}

export interface OwnerStatusPayload {
  watch: LiveWatchModel;
  simulationWatch: LiveWatchModel;
  owner: OwnerExtras;
  halt: HaltState;
  publicLive: PublicLiveStats;
  publicLiveSimulation: PublicLiveStats;
  source: 'live' | 'snapshot' | 'onchain' | 'mixed';
  snapshotAgeMs: number | null;
}

function mergeWatches(a: LiveWatchModel, b?: LiveWatchModel | null): LiveWatchModel {
  if (!b) return a;
  const seenF = new Set(a.feed.map((f) => f.id));
  const seenO = new Set(a.openAll.map((p) => p.id));
  return {
    ...a,
    feed: [...a.feed, ...b.feed.filter((f) => !seenF.has(f.id))],
    openAll: [...a.openAll, ...b.openAll.filter((p) => !seenO.has(p.id))],
    open: a.open ?? b.open,
  };
}

function withIsolatedBooks(
  payload: Omit<OwnerStatusPayload, 'watch' | 'simulationWatch' | 'publicLive' | 'publicLiveSimulation'> & {
    watch: LiveWatchModel;
    simulationWatch?: LiveWatchModel | null;
    publicLive?: PublicLiveStats | null;
    publicLiveSimulation?: PublicLiveStats | null;
  },
  recorded: import('./public-live').RecordedPublicTrade[],
  liveEquity: number | null,
): OwnerStatusPayload {
  const books = recorded.length
    ? buildPublicBooks(recorded)
    : payload.publicLive && payload.publicLive.book === 'live' && payload.publicLiveSimulation
      ? { live: payload.publicLive, simulation: payload.publicLiveSimulation }
      : booksFromMaybeMixed(payload.publicLive ?? null);
  const isolated = isolateLiveWatch(mergeWatches(payload.watch, payload.simulationWatch), liveEquity);
  const solPrice = payload.owner?.onchain?.solPriceUsd ?? payload.watch.solPriceUsd ?? null;
  return {
    ...payload,
    watch: isolated.live,
    simulationWatch: isolated.simulation,
    publicLive: books.live,
    publicLiveSimulation: books.simulation,
    owner: { ...payload.owner, plan: planForLiveEquity(payload.owner.plan, liveEquity, solPrice) },
  };
}

function canUseDb(): boolean {
  if (isDemo()) return false;
  const url = process.env.DATABASE_URL ?? '';
  return Boolean(url) && !url.startsWith('file:'); // Prisma on Vercel demo is not the box
}

async function fromDatabase(): Promise<{ watch: LiveWatchModel; plan: OwnerPlanStatusView | null; engine: OwnerExtras['engine']; recordedPlanClosed: Parameters<typeof recordedFromClosedPositions>[0] } | null> {
  if (!canUseDb()) return null;
  try {
    const { prisma } = await import('./db');
    const { ensureOperatorAccount, accountEquity, getEngineState, mem, periodPnl } = await import('./engine');
    const { ownerPlanStatus } = await import('./profit-sweep');
    const { isWithinSchedule } = await import('./config');
    const c = getConfig();
    const account = await ensureOperatorAccount();
    const [st, eq] = await Promise.all([getEngineState(), accountEquity(account)]);
    const closed = await prisma.position.findMany({ where: { accountId: account.id, status: 'closed' }, orderBy: { closedAt: 'desc' }, take: 100 });
    const pnl = await periodPnl(account.id, c.timezone);
    const plan = await ownerPlanStatus({ equityUsd: eq.equity, openPositions: eq.open.length, cashUsd: account.cashUsd, solPriceUsd: mem.solPrice || c.solPriceFallbackUsd });
    const sl = plan.stopLossPct;
    const tp = plan.takeProfitPct;
    const statusLike = {
      asOf: new Date().toISOString(),
      config: { mode: c.mode, stopLossPct: sl, takeProfitPct: tp },
      engine: { killSwitch: st.killSwitch, killReason: st.killReason },
      account: {
        equity: eq.equity, cash: account.cashUsd, realizedPnl: account.realizedPnl,
        unrealizedPnl: eq.open.reduce((s, p) => s + (p.tokenAmount * p.lastPrice - p.sizeUsd - p.feesUsd), 0),
        paused: account.paused, startingBalance: account.startingBalance, pnl: { day: pnl.day },
      },
      open: eq.open.map((p) => ({
        id: p.id, symbol: p.symbol, mint: p.mint, pairAddress: p.pairAddress, sizeUsd: p.sizeUsd,
        entryPrice: p.entryPrice, lastPrice: p.lastPrice,
        pnlUsd: p.tokenAmount * p.lastPrice - p.sizeUsd - p.feesUsd,
        pnlPct: (p.lastPrice / p.entryPrice - 1) * 100,
        openedAt: p.openedAt, entryTx: p.entryTx, simulated: p.simulated,
        solscanEntry: solscanTxUrl(p.entryTx), solscanMint: solscanAccountUrl(p.mint),
      })),
      closed: closed.map((p) => ({
        id: p.id, symbol: p.symbol, mint: p.mint, sizeUsd: p.sizeUsd, entryPrice: p.entryPrice, exitPrice: p.exitPrice,
        pnlUsd: p.pnlUsd, pnlPct: p.pnlPct, exitReason: p.exitReason, openedAt: p.openedAt, closedAt: p.closedAt,
        simulated: p.simulated, entryTx: p.entryTx, exitTx: p.exitTx,
        solscanExit: solscanTxUrl(p.exitTx), solscanMint: solscanAccountUrl(p.mint),
      })),
    };
    const watch = liveWatchFromAccountStatus(statusLike, { scope: 'owner', label: 'Cletus (house)', chartApiBase: '/api/owner/chart' });
    return {
      watch,
      plan,
      engine: {
        mode: c.mode, liveBlockedReason: c.liveBlockedReason, killSwitch: st.killSwitch, killReason: st.killReason,
        lastScanAt: st.lastScanAt ? st.lastScanAt.toISOString() : null, scanCount: st.scanCount,
        lastScanSummary: mem.lastScanSummary, withinSchedule: isWithinSchedule(c),
        brainProvider: process.env.BRAIN_PROVIDER ?? null,
      },
      recordedPlanClosed: closed.map((p) => ({
        id: p.id, symbol: p.symbol, closedAt: p.closedAt, pnlUsd: p.pnlUsd, pnlPct: p.pnlPct,
        exitTx: p.exitTx, entryTx: p.entryTx, simulated: p.simulated, isOperator: true,
      })),
    };
  } catch {
    return null;
  }
}

function fallbackPlan(equityUsd: number, openPositions: number, solPriceUsd: number): OwnerPlanStatusView {
  const plan = parseOwnerPlanConfig(process.env);
  const sized = tradeSizeForEquity(equityUsd, plan.sizeTiers, plan.sizeStepUsd, plan.sizeIncrementUsd);
  return {
    enabled: plan.enabled, sweepArmed: plan.sweepArmed, sweepPausedReason: plan.sweepArmed ? null : 'Payout wallet is not confirmed',
    payoutWallet: plan.payoutWallet, tradingWallet: OWNER_TRADING_WALLET, equityUsd,
    currentTier: sized.tier, tradeSizeUsd: sized.sizeUsd, feeReserveSol: plan.feeReserveSol,
    feeReserveUsd: plan.feeReserveSol * solPriceUsd, currentBaseUsd: 0, nextSweepTargetUsd: plan.ladder.firstTargetUsd,
    totalPaidUsd: 0, paidTodayUsd: 0, openPositions, stopLossPct: plan.stopLossPct, takeProfitPct: plan.takeProfitPct,
    maxOpenPositions: plan.maxOpenPositions, mcapPreset: 'BALANCED', payouts: [],
  };
}

/** Size the money-plan card off the live on-chain wallet, not leftover paper equity. */
export function planForLiveEquity(plan: OwnerPlanStatusView | null, liveEquityUsd: number | null, solPriceUsd: number | null): OwnerPlanStatusView | null {
  if (!plan || liveEquityUsd == null) return plan;
  const cfg = parseOwnerPlanConfig(process.env);
  const sized = tradeSizeForEquity(liveEquityUsd, cfg.sizeTiers, cfg.sizeStepUsd, cfg.sizeIncrementUsd);
  const solPrice = solPriceUsd ?? (plan.feeReserveUsd && cfg.feeReserveSol ? plan.feeReserveUsd / cfg.feeReserveSol : 0);
  const reserveUsd = cfg.feeReserveSol * solPrice;
  const spendable = Math.max(0, liveEquityUsd - reserveUsd);
  const tradeSizeUsd = Math.floor(Math.min(sized.sizeUsd, spendable) * 100) / 100;
  return {
    ...plan,
    equityUsd: liveEquityUsd,
    currentTier: sized.tier,
    tradeSizeUsd: tradeSizeUsd >= cfg.minTradeUsd ? tradeSizeUsd : 0,
    feeReserveUsd: reserveUsd,
  };
}

function applyLogAndChain(watch: LiveWatchModel, plan: OwnerPlanStatusView | null, onchain: Awaited<ReturnType<typeof readOnchainWallet>> | null): LiveWatchModel {
  const events = readLiveTrades();
  const fromLog = feedFromLiveEvents(events);
  const feed = mergeFeed(fromLog, watch.feed);
  const sells = feed.filter((f: LiveWatchFeedItem) => f.kind === 'sell');
  const wl = winLoss(sells);
  let open = watch.open;
  if (!open) {
    const lastBuy = fromLog.find((f) => f.kind === 'buy' && !sells.some((s) => s.mint && s.mint === f.mint && Date.parse(s.at) > Date.parse(f.at)));
    if (lastBuy && lastBuy.mint && lastBuy.entryPrice) {
      const sl = plan?.stopLossPct;
      const tp = plan?.takeProfitPct;
      open = enrichPosition({
        id: lastBuy.id, symbol: lastBuy.symbol, mint: lastBuy.mint, sizeUsd: lastBuy.sizeUsd ?? 0,
        entryPrice: lastBuy.entryPrice, lastPrice: lastBuy.exitPrice ?? lastBuy.entryPrice,
        pnlUsd: 0, pnlPct: 0, openedAt: lastBuy.at, entryTx: null, solscanEntry: lastBuy.solscan,
        solscanMint: lastBuy.solscanMint, simulated: lastBuy.simulated,
      }, sl, tp);
    }
  }
  const equity = onchain?.equityUsd ?? watch.equityUsd;
  const realized = sells.length ? sells.reduce((s, t) => s + (t.pnlUsd ?? 0), 0) : watch.realizedPnl;
  const today = sells.length ? sumTodayPnl(sells.map((t) => ({ pnlUsd: t.pnlUsd, at: t.at }))) : watch.todayPnl;
  const curve = watch.equityCurve.length > 1 ? watch.equityCurve : curveFromClosed(equity != null ? equity - realized : 0, sells.map((t) => ({ at: t.at, pnlUsd: t.pnlUsd })), equity);
  const c = getConfig();
  return {
    ...watch,
    equityUsd: equity,
    sol: onchain?.sol ?? watch.sol,
    solPriceUsd: onchain?.solPriceUsd ?? watch.solPriceUsd,
    realizedPnl: realized,
    totalPnl: realized + watch.unrealizedPnl,
    todayPnl: today,
    winRate: wl.winRate ?? watch.winRate,
    wins: wl.wins || watch.wins,
    losses: wl.losses || watch.losses,
    closedTrades: sells.length || watch.closedTrades,
    open: open ?? watch.open,
    openAll: open && !watch.openAll.some((p: LiveWatchPosition) => p.id === open!.id) ? [open, ...watch.openAll] : watch.openAll,
    feed,
    equityCurve: curve,
    mode: c.mode,
    simulatedBadge: c.mode !== 'live' || feed.some((f) => f.simulated) || (open?.simulated ?? false),
    chartApiBase: '/api/owner/chart',
    scope: 'owner',
    label: 'Cletus (house)',
  };
}

export async function buildOwnerStatus(): Promise<OwnerStatusPayload> {
  const c = getConfig();
  const stored = loadOwnerState();
  const age = snapshotAgeMs(stored);
  const [db, onchain] = await Promise.all([
    fromDatabase(),
    readOnchainWallet(OWNER_TRADING_WALLET).catch(() => null),
  ]);

  const halt: HaltState = stored.halt?.rev ? stored.halt : (db?.engine.killSwitch ? { ...EMPTY_HALT, halted: true, reason: db.engine.killReason, source: 'engine', rev: 1 } : { ...EMPTY_HALT });

  if (db) {
    const watch = applyLogAndChain({ ...db.watch, halted: halt.halted, haltReason: halt.reason }, db.plan, onchain);
    const events = readLiveTrades();
    const recorded = mergeRecorded(recordedFromClosedPositions(db.recordedPlanClosed), recordedFromLiveEvents(events, true));
    return withIsolatedBooks({
      watch, halt, snapshotAgeMs: age,
      source: onchain ? 'mixed' : 'live',
      owner: {
        tradingWallet: OWNER_TRADING_WALLET,
        payoutWallet: c.ownerPlan.payoutWallet,
        ownerWallet: resolveOwnerWallet(),
        plan: db.plan,
        engine: { ...db.engine, killSwitch: halt.halted || db.engine.killSwitch, killReason: halt.reason ?? db.engine.killReason },
        onchain,
      },
    }, recorded, onchain?.equityUsd ?? watch.equityUsd ?? null);
  }

  if (stored.snapshot?.payload && (age === null || age < 5 * 60_000)) {
    const snap = stored.snapshot.payload as OwnerStatusPayload;
    // Refresh on-chain balance on top of a recent snapshot so the hero stays live on Vercel.
    const watch = snap.watch ? { ...snap.watch, equityUsd: onchain?.equityUsd ?? snap.watch.equityUsd, sol: onchain?.sol ?? snap.watch.sol, solPriceUsd: onchain?.solPriceUsd ?? snap.watch.solPriceUsd, halted: halt.halted } : applyLogAndChain(emptyWatch(c.mode, onchain), snap.owner?.plan ?? null, onchain);
    return withIsolatedBooks({
      watch, simulationWatch: snap.simulationWatch, halt,
      publicLive: snap.publicLive, publicLiveSimulation: snap.publicLiveSimulation,
      source: 'snapshot', snapshotAgeMs: age,
      owner: {
        ...(snap.owner ?? emptyOwner(c, onchain)),
        onchain: onchain ?? snap.owner?.onchain ?? null,
      },
    }, recordedFromLiveEvents(readLiveTrades(), true), onchain?.equityUsd ?? watch.equityUsd ?? null);
  }

  const plan = fallbackPlan(onchain?.equityUsd ?? 0, 0, onchain?.solPriceUsd ?? c.solPriceFallbackUsd);
  const events = readLiveTrades();
  const watch = applyLogAndChain(emptyWatch(c.mode, onchain), plan, onchain);
  return withIsolatedBooks({
    watch, halt,
    source: events.length ? 'mixed' : 'onchain',
    snapshotAgeMs: age,
    owner: emptyOwner(c, onchain, plan),
  }, recordedFromLiveEvents(events, true), onchain?.equityUsd ?? watch.equityUsd ?? null);
}

function emptyWatch(mode: 'simulation' | 'live', onchain: Awaited<ReturnType<typeof readOnchainWallet>> | null): LiveWatchModel {
  return {
    asOf: new Date().toISOString(), mode, scope: 'owner', label: 'Cletus (house)',
    equityUsd: onchain?.equityUsd ?? null, sol: onchain?.sol ?? null, solPriceUsd: onchain?.solPriceUsd ?? null,
    realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0, todayPnl: 0, winRate: null, wins: 0, losses: 0, closedTrades: 0,
    open: null, openAll: [], feed: [], equityCurve: onchain?.equityUsd != null ? [{ t: new Date().toISOString(), equityUsd: onchain.equityUsd }] : [],
    halted: false, paused: false, haltReason: null, chartApiBase: '/api/owner/chart', simulatedBadge: mode !== 'live',
  };
}

function emptyOwner(c: ReturnType<typeof getConfig>, onchain: Awaited<ReturnType<typeof readOnchainWallet>> | null, plan?: OwnerPlanStatusView | null): OwnerExtras {
  return {
    tradingWallet: OWNER_TRADING_WALLET,
    payoutWallet: c.ownerPlan.payoutWallet,
    ownerWallet: resolveOwnerWallet(),
    plan: plan ?? fallbackPlan(onchain?.equityUsd ?? 0, 0, onchain?.solPriceUsd ?? c.solPriceFallbackUsd),
    engine: {
      mode: c.mode, liveBlockedReason: c.liveBlockedReason, killSwitch: false, killReason: null,
      lastScanAt: null, scanCount: null, lastScanSummary: null, withinSchedule: null,
      brainProvider: process.env.BRAIN_PROVIDER ?? null,
    },
    onchain,
  };
}

