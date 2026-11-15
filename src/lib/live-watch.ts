/**
 * Shared live trade-watching model used by:
 *  - every signed-in user (their own positions, scoped by account / wallet)
 *  - the owner dashboard at /owner (operator wallet + money-plan extras)
 *  - the public demo (explicitly simulated / illustrative data)
 *
 * The UI lives in `components/LiveWatch.tsx`. This file is the data shape and
 * pure helpers so each surface can map its own source without inventing numbers.
 */
import { solscanAccountUrl, solscanTxUrl } from './approvals';
import { isLiveBookTrade, LIVE_BOOK_START_ISO, LIVE_EMPTY_MESSAGE } from './live-book';
import { todayPnl as todayPnlFromEvents, equityCurveFromEvents, realizedPnl, type LiveTradeEvent } from './live-trades';
import { DEFAULT_OWNER_STOP_LOSS_PCT, DEFAULT_OWNER_TAKE_PROFIT_PCT } from './owner-plan';

export type LiveWatchScope = 'owner' | 'user' | 'demo';

export interface LiveWatchPosition {
  id: string;
  symbol: string;
  mint: string;
  pairAddress?: string | null;
  sizeUsd: number;
  entryPrice: number;
  lastPrice: number;
  pnlUsd: number;
  pnlPct: number;
  stopLoss: number | null;
  takeProfit: number | null;
  openedAt: string;
  entryTx?: string | null;
  solscanEntry?: string | null;
  solscanMint?: string | null;
  simulated: boolean;
}

export interface LiveWatchFeedItem {
  id: string;
  kind: 'buy' | 'sell' | 'sweep';
  at: string;
  symbol: string;
  mint?: string | null;
  sizeUsd?: number | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  pnlUsd?: number | null;
  pnlPct?: number | null;
  reason?: string | null;
  win: boolean | null;
  solscan?: string | null;
  solscanMint?: string | null;
  simulated: boolean;
}

export interface LiveWatchPoint { t: string; equityUsd: number }

export interface LiveWatchModel {
  asOf: string;
  mode: 'simulation' | 'live';
  scope: LiveWatchScope;
  label: string;
  equityUsd: number | null;
  cashUsd?: number | null;
  sol?: number | null;
  solPriceUsd?: number | null;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  todayPnl: number;
  winRate: number | null;
  wins: number;
  losses: number;
  closedTrades: number;
  /** Primary open position shown on the hero chart (owner is one-at-a-time). */
  open: LiveWatchPosition | null;
  openAll: LiveWatchPosition[];
  feed: LiveWatchFeedItem[];
  equityCurve: LiveWatchPoint[];
  halted?: boolean;
  paused?: boolean;
  haltReason?: string | null;
  chartApiBase: string;
  simulatedBadge: boolean;
  book?: 'live' | 'simulation';
  emptyMessage?: string | null;
  /** Optional on-chain address shown on the owner desk (not used on public/user views). */
  walletAddress?: string | null;
}

export function stopTakeLevels(entryPrice: number, stopLossPct = DEFAULT_OWNER_STOP_LOSS_PCT, takeProfitPct = DEFAULT_OWNER_TAKE_PROFIT_PCT): { stopLoss: number; takeProfit: number } {
  return {
    stopLoss: entryPrice * (1 - stopLossPct / 100),
    takeProfit: entryPrice * (1 + takeProfitPct / 100),
  };
}

export function enrichPosition(p: Omit<LiveWatchPosition, 'stopLoss' | 'takeProfit'> & { stopLoss?: number | null; takeProfit?: number | null }, slPct?: number, tpPct?: number): LiveWatchPosition {
  const levels = stopTakeLevels(p.entryPrice, slPct, tpPct);
  return { ...p, stopLoss: p.stopLoss ?? levels.stopLoss, takeProfit: p.takeProfit ?? levels.takeProfit };
}

export function winLoss(closed: Array<{ pnlUsd?: number | null }>): { wins: number; losses: number; winRate: number | null } {
  const decided = closed.filter((t) => t.pnlUsd !== null && t.pnlUsd !== undefined);
  const wins = decided.filter((t) => (t.pnlUsd ?? 0) > 0).length;
  const losses = decided.filter((t) => (t.pnlUsd ?? 0) <= 0).length;
  const n = wins + losses;
  return { wins, losses, winRate: n ? wins / n : null };
}

export function chicagoDay(iso: string, timeZone = 'America/Chicago'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function sumTodayPnl(closed: Array<{ pnlUsd?: number | null; closedAt?: string | null; at?: string }>, now = new Date(), timeZone = 'America/Chicago'): number {
  const day = chicagoDay(now.toISOString(), timeZone);
  let sum = 0;
  for (const t of closed) {
    const at = t.closedAt ?? t.at;
    if (t.pnlUsd === null || t.pnlUsd === undefined || !at) continue;
    if (chicagoDay(at, timeZone) === day) sum += t.pnlUsd;
  }
  return Math.round(sum * 100) / 100;
}

export function curveFromClosed(startingEquityUsd: number, closed: Array<{ closedAt?: string | null; at?: string; pnlUsd?: number | null }>, currentEquityUsd?: number | null, now = new Date()): LiveWatchPoint[] {
  const sorted = [...closed].filter((t) => (t.closedAt ?? t.at) && t.pnlUsd !== null && t.pnlUsd !== undefined)
    .sort((a, b) => Date.parse(String(a.closedAt ?? a.at)) - Date.parse(String(b.closedAt ?? b.at)));
  const out: LiveWatchPoint[] = [];
  if (Number.isFinite(startingEquityUsd)) {
    const first = sorted[0];
    const t0 = first ? new Date(Date.parse(String(first.closedAt ?? first.at)) - 1000).toISOString() : now.toISOString();
    out.push({ t: t0, equityUsd: startingEquityUsd });
  }
  let eq = startingEquityUsd;
  for (const t of sorted) {
    eq = Math.round((eq + (t.pnlUsd ?? 0)) * 100) / 100;
    out.push({ t: String(t.closedAt ?? t.at), equityUsd: eq });
  }
  if (currentEquityUsd !== null && currentEquityUsd !== undefined) {
    const last = out[out.length - 1];
    if (!last || last.equityUsd !== currentEquityUsd) out.push({ t: now.toISOString(), equityUsd: currentEquityUsd });
  }
  return out;
}

export function feedFromLiveEvents(events: LiveTradeEvent[]): LiveWatchFeedItem[] {
  return [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((e, i) => ({
    id: `${e.kind}-${e.signature ?? e.at}-${i}`,
    kind: e.kind,
    at: e.at,
    symbol: e.symbol,
    mint: e.mint,
    sizeUsd: e.sizeUsd,
    entryPrice: e.entryPrice,
    exitPrice: e.exitPrice,
    pnlUsd: e.pnlUsd,
    pnlPct: e.pnlPct,
    reason: e.reason,
    win: e.kind === 'sell' && e.pnlUsd !== null ? e.pnlUsd > 0 : null,
    solscan: e.solscan ?? solscanTxUrl(e.signature),
    solscanMint: e.solscanMint ?? solscanAccountUrl(e.mint),
    simulated: e.simulated,
  }));
}

export function mergeFeed(primary: LiveWatchFeedItem[], extra: LiveWatchFeedItem[]): LiveWatchFeedItem[] {
  const seen = new Set<string>();
  const out: LiveWatchFeedItem[] = [];
  for (const item of [...primary, ...extra]) {
    const key = item.solscan || `${item.kind}:${item.at}:${item.symbol}:${item.pnlUsd ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Map the existing /api/status (or a compatible object) into the shared watch model. User-scoped. */
export function liveWatchFromAccountStatus(s: {
  asOf?: string;
  config?: { mode?: string; stopLossPct?: number; takeProfitPct?: number };
  engine?: { killSwitch?: boolean; killReason?: string | null };
  account?: { equity?: number; cash?: number; realizedPnl?: number; unrealizedPnl?: number; paused?: boolean; startingBalance?: number; pnl?: { day?: number } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  open?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  closed?: any[];
}, opts?: { scope?: LiveWatchScope; label?: string; chartApiBase?: string }): LiveWatchModel {
  const sl = Number(s.config?.stopLossPct ?? DEFAULT_OWNER_STOP_LOSS_PCT);
  const tp = Number(s.config?.takeProfitPct ?? DEFAULT_OWNER_TAKE_PROFIT_PCT);
  const openAll = (s.open ?? []).map((p, i) => enrichPosition({
    id: String(p.id ?? i),
    symbol: String(p.symbol ?? 'TOKEN'),
    mint: String(p.mint ?? ''),
    pairAddress: (p.pairAddress as string) ?? null,
    sizeUsd: Number(p.sizeUsd ?? 0),
    entryPrice: Number(p.entryPrice ?? 0),
    lastPrice: Number(p.lastPrice ?? p.entryPrice ?? 0),
    pnlUsd: Number(p.pnlUsd ?? 0),
    pnlPct: Number(p.pnlPct ?? 0),
    openedAt: String(p.openedAt ?? ''),
    entryTx: (p.entryTx as string) ?? null,
    solscanEntry: (p.solscanEntry as string) ?? solscanTxUrl(p.entryTx as string),
    solscanMint: (p.solscanMint as string) ?? solscanAccountUrl(p.mint as string),
    simulated: p.simulated !== false,
  }, sl, tp));
  const closed = (s.closed ?? []).map((t, i) => ({
    id: String(t.id ?? i),
    kind: 'sell' as const,
    at: String(t.closedAt ?? t.at ?? ''),
    symbol: String(t.symbol ?? 'TOKEN'),
    mint: (t.mint as string) ?? null,
    sizeUsd: Number(t.sizeUsd ?? 0),
    entryPrice: t.entryPrice == null ? null : Number(t.entryPrice),
    exitPrice: t.exitPrice == null ? null : Number(t.exitPrice),
    pnlUsd: t.pnlUsd == null ? null : Number(t.pnlUsd),
    pnlPct: t.pnlPct == null ? null : Number(t.pnlPct),
    reason: (t.exitReason as string) ?? (t.reason as string) ?? null,
    win: t.pnlUsd == null ? null : Number(t.pnlUsd) > 0,
    solscan: (t.solscanExit as string) ?? solscanTxUrl(t.exitTx as string),
    solscanMint: (t.solscanMint as string) ?? solscanAccountUrl(t.mint as string),
    simulated: t.simulated !== false,
  }));
  const wl = winLoss(closed);
  const realized = Number(s.account?.realizedPnl ?? closed.reduce((n, t) => n + (t.pnlUsd ?? 0), 0));
  const unrealized = Number(s.account?.unrealizedPnl ?? openAll.reduce((n, p) => n + p.pnlUsd, 0));
  const equity = s.account?.equity ?? null;
  const start = Number(s.account?.startingBalance ?? 0);
  const mode = s.config?.mode === 'live' ? 'live' : 'simulation';
  const simulatedBadge = mode !== 'live' || openAll.some((p) => p.simulated) || closed.some((t) => t.simulated);
  return {
    asOf: s.asOf ?? new Date().toISOString(),
    mode,
    scope: opts?.scope ?? 'user',
    label: opts?.label ?? 'Your trades',
    equityUsd: equity,
    cashUsd: s.account?.cash ?? null,
    realizedPnl: realized,
    unrealizedPnl: unrealized,
    totalPnl: realized + unrealized,
    todayPnl: s.account?.pnl?.day ?? sumTodayPnl(closed.map((t) => ({ pnlUsd: t.pnlUsd, at: t.at }))),
    winRate: wl.winRate,
    wins: wl.wins,
    losses: wl.losses,
    closedTrades: closed.length,
    open: openAll[0] ?? null,
    openAll,
    feed: closed,
    equityCurve: curveFromClosed(start, closed.map((t) => ({ closedAt: t.at, pnlUsd: t.pnlUsd })), equity),
    halted: Boolean(s.engine?.killSwitch),
    paused: Boolean(s.account?.paused),
    haltReason: s.engine?.killReason ?? null,
    chartApiBase: opts?.chartApiBase ?? (opts?.scope === 'demo' ? '/api/demo/chart' : '/api/tokens/chart'),
    simulatedBadge,
  };
}

export { todayPnlFromEvents, equityCurveFromEvents, realizedPnl };


/** Split a mixed watch model into the live book (default) and simulation history. */
export function isolateLiveWatch(watch: LiveWatchModel, liveEquityUsd: number | null): { live: LiveWatchModel; simulation: LiveWatchModel } {
  const liveFeed = watch.feed.filter((f) => isLiveBookTrade({ at: f.at, simulated: f.simulated }));
  const simFeed = watch.feed.filter((f) => !isLiveBookTrade({ at: f.at, simulated: f.simulated }));
  const liveOpenAll = watch.openAll.filter((p) => isLiveBookTrade({ openedAt: p.openedAt, at: p.openedAt, simulated: p.simulated }));
  const simOpenAll = watch.openAll.filter((p) => !isLiveBookTrade({ openedAt: p.openedAt, at: p.openedAt, simulated: p.simulated }));
  const liveOpen = liveOpenAll[0] ?? null;
  const simOpen = simOpenAll[0] ?? null;
  const liveSells = liveFeed.filter((f) => f.kind === 'sell');
  const simSells = simFeed.filter((f) => f.kind === 'sell');
  const liveWl = winLoss(liveSells);
  const simWl = winLoss(simSells);
  const liveRealized = liveSells.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
  const simRealized = simSells.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
  const liveUnreal = liveOpenAll.reduce((s, p) => s + p.pnlUsd, 0);
  const simUnreal = simOpenAll.reduce((s, p) => s + p.pnlUsd, 0);
  const liveEq = liveEquityUsd;
  // Start the live curve at current live equity minus live realized and open PnL (the wallet at live start).
  const liveStartEq = liveEq == null ? 0 : Math.round((liveEq - liveRealized - liveUnreal) * 100) / 100;
  const liveClosedTrades = liveSells.length;
  const live: LiveWatchModel = {
    ...watch,
    mode: 'live',
    label: watch.scope === 'owner' ? 'Cletus (house)' : watch.label,
    book: 'live',
    simulatedBadge: false,
    equityUsd: liveEq,
    realizedPnl: Math.round(liveRealized * 100) / 100,
    unrealizedPnl: Math.round(liveUnreal * 100) / 100,
    totalPnl: Math.round((liveRealized + liveUnreal) * 100) / 100,
    todayPnl: sumTodayPnl(liveSells.map((t) => ({ pnlUsd: t.pnlUsd, at: t.at }))),
    winRate: liveWl.winRate,
    wins: liveWl.wins,
    losses: liveWl.losses,
    closedTrades: liveClosedTrades,
    open: liveOpen,
    openAll: liveOpenAll,
    feed: liveFeed,
    equityCurve: liveClosedTrades ? curveFromClosed(liveStartEq, liveSells.map((t) => ({ at: t.at, pnlUsd: t.pnlUsd })), liveEq) : (liveEq != null ? [{ t: LIVE_BOOK_START_ISO, equityUsd: liveStartEq }, { t: watch.asOf, equityUsd: liveEq }] : []),
    emptyMessage: liveClosedTrades || liveOpen ? null : LIVE_EMPTY_MESSAGE,
  };
  const inferredSimStart = (watch.equityUsd ?? 0) - watch.totalPnl + simRealized + simUnreal;
  const curveStart = watch.equityCurve[0]?.equityUsd;
  // Prefer the original paper starting equity when the mixed curve still has it
  // (e.g. ~$10k) so the simulation book is not pinned to the $10 live wallet.
  const simStartEq = curveStart != null && curveStart > inferredSimStart + 50 ? curveStart : inferredSimStart;
  const simTotal = Math.round((simRealized + simUnreal) * 100) / 100;
  const simEquity = Math.round((simStartEq + simRealized + simUnreal) * 100) / 100;
  const simulation: LiveWatchModel = {
    ...watch,
    mode: 'simulation',
    label: 'Simulation history',
    book: 'simulation',
    simulatedBadge: true,
    equityUsd: simSells.length || simOpen ? simEquity : null,
    realizedPnl: Math.round(simRealized * 100) / 100,
    unrealizedPnl: Math.round(simUnreal * 100) / 100,
    totalPnl: simTotal,
    todayPnl: sumTodayPnl(simSells.map((t) => ({ pnlUsd: t.pnlUsd, at: t.at }))),
    winRate: simWl.winRate,
    wins: simWl.wins,
    losses: simWl.losses,
    closedTrades: simSells.length,
    open: simOpen,
    openAll: simOpenAll,
    feed: simFeed,
    equityCurve: curveFromClosed(simStartEq, simSells.map((t) => ({ at: t.at, pnlUsd: t.pnlUsd }))),
    emptyMessage: simSells.length || simOpen ? null : 'No simulation history.',
  };
  return { live, simulation };
}
