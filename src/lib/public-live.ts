/**
 * Public, anonymized live-performance feed (homepage + /live).
 *
 * Rules:
 *  - Only REAL recorded trades (closed positions, live-trade log, profit sweeps).
 *    Never fabricate, pad, or substitute illustrative demo numbers.
 *  - If there are no recorded trades, the payload is empty (hasData=false). Totals
 *    are null, not $0 dressed up as a result.
 *  - Anonymize traders. No wallet addresses unless the user has opted in.
 *    Owner / operator / house trades are labelled "Cletus (house)".
 *  - When every included trade is simulated (paper), the simulation badge is on.
 *    Mixed books are labelled so live and paper are not confused.
 *  - The standard not-financial-advice / past-results disclaimer travels with the stats.
 */
import { solscanTxUrl } from './approvals';
import { chicagoDay, sumTodayPnl, winLoss } from './live-watch';
import { isLiveBookTrade, LIVE_BOOK_START_ISO, LIVE_EMPTY_MESSAGE, type BookKind } from './live-book';
export { isLiveBookTrade, LIVE_BOOK_START_ISO, LIVE_EMPTY_MESSAGE, type BookKind } from './live-book';
import type { LiveTradeEvent } from './live-trades';

export const PUBLIC_LIVE_DISCLAIMER =
  'Not financial advice. Past results, including simulated or paper results, do not predict future results. Losses, including total loss of principal, can occur. These figures are recorded trades only and are not a promise of returns.';

export const HOUSE_TRADER_LABEL = 'Cletus (house)';
export const ANON_TRADER_LABEL = 'Trader';

export interface RecordedPublicTrade {
  id: string;
  at: string;
  symbol: string;
  side: 'buy' | 'sell' | 'sweep';
  pnlPct: number | null;
  pnlUsd: number | null;
  signature: string | null;
  simulated: boolean;
  isHouse: boolean;
  /** Only used when the user opted in to be named. Never a wallet unless opted in. */
  optedInLabel?: string | null;
  showWallet?: boolean;
  wallet?: string | null;
}

export interface PublicLiveTickerItem {
  id: string;
  at: string;
  token: string;
  side: 'buy' | 'sell' | 'sweep';
  pnlPct: number | null;
  solscan: string | null;
  simulated: boolean;
  trader: string;
}

export interface PublicLiveStats {
  asOf: string | null;
  hasData: boolean;
  source: 'recorded' | 'none';
  /** True when every included closed trade is simulated / paper. */
  allSimulated: boolean;
  /** True when at least one included trade is simulated. */
  anySimulated: boolean;
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  /** Aggregate realized P&L across the recorded book. Null when there is no data. */
  totalPnlUsd: number | null;
  todayPnlUsd: number | null;
  ticker: PublicLiveTickerItem[];
  disclaimer: string;
  book?: BookKind;
  liveBookStart?: string;
  emptyMessage?: string | null;
  hasSimulationHistory?: boolean;
}

export const EMPTY_PUBLIC_LIVE: PublicLiveStats = {
  asOf: null,
  hasData: false,
  source: 'none',
  allSimulated: false,
  anySimulated: false,
  tradeCount: 0,
  wins: 0,
  losses: 0,
  winRate: null,
  totalPnlUsd: null,
  todayPnlUsd: null,
  ticker: [],
  disclaimer: PUBLIC_LIVE_DISCLAIMER,
  book: 'live',
  liveBookStart: LIVE_BOOK_START_ISO,
  emptyMessage: LIVE_EMPTY_MESSAGE,
  hasSimulationHistory: false,
};

export function traderLabel(t: Pick<RecordedPublicTrade, 'isHouse' | 'optedInLabel' | 'showWallet' | 'wallet'>): string {
  if (t.isHouse) return HOUSE_TRADER_LABEL;
  if (t.optedInLabel && t.optedInLabel.trim()) return t.optedInLabel.trim().slice(0, 32);
  // Wallets are never shown unless the user opted in (and even then we prefer a handle).
  if (t.showWallet && t.wallet) {
    const a = t.wallet;
    return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
  }
  return ANON_TRADER_LABEL;
}

export function buildPublicLiveStats(trades: RecordedPublicTrade[], now = new Date(), timeZone = 'America/Chicago', tickerLimit = 40): PublicLiveStats {
  // Public ticker of *closed* results (sells + sweeps). Buys are omitted so we
  // don't leak in-progress activity; % gain/loss is only meaningful on a close.
  const closed = trades.filter((t) => t.side === 'sell' || t.side === 'sweep');
  if (!closed.length) return { ...EMPTY_PUBLIC_LIVE, asOf: now.toISOString() };

  const sells = closed.filter((t) => t.side === 'sell');
  const wl = winLoss(sells);
  const total = sells.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
  const today = sumTodayPnl(sells.map((t) => ({ pnlUsd: t.pnlUsd, at: t.at })), now, timeZone);
  const anySimulated = closed.some((t) => t.simulated);
  const allSimulated = closed.every((t) => t.simulated);
  const ticker: PublicLiveTickerItem[] = [...closed]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, tickerLimit)
    .map((t) => ({
      id: t.id,
      at: t.at,
      token: t.symbol,
      side: t.side,
      pnlPct: t.pnlPct,
      solscan: solscanTxUrl(t.signature),
      simulated: t.simulated,
      trader: traderLabel(t),
    }));

  return {
    asOf: now.toISOString(),
    hasData: true,
    source: 'recorded',
    allSimulated,
    anySimulated,
    tradeCount: sells.length,
    wins: wl.wins,
    losses: wl.losses,
    winRate: wl.winRate,
    totalPnlUsd: Math.round(total * 100) / 100,
    todayPnlUsd: today,
    ticker,
    disclaimer: PUBLIC_LIVE_DISCLAIMER,
  };
}

export function splitRecorded(trades: RecordedPublicTrade[]): { live: RecordedPublicTrade[]; simulation: RecordedPublicTrade[] } {
  const live: RecordedPublicTrade[] = [];
  const simulation: RecordedPublicTrade[] = [];
  for (const r of trades) (isLiveBookTrade(r) ? live : simulation).push(r);
  return { live, simulation };
}

export function emptyLiveStats(now = new Date(), hasSimulationHistory = false): PublicLiveStats {
  return {
    ...EMPTY_PUBLIC_LIVE,
    asOf: now.toISOString(),
    book: 'live',
    liveBookStart: LIVE_BOOK_START_ISO,
    emptyMessage: LIVE_EMPTY_MESSAGE,
    hasSimulationHistory,
  };
}

export function buildPublicBooks(trades: RecordedPublicTrade[], now = new Date(), timeZone = 'America/Chicago'): { live: PublicLiveStats; simulation: PublicLiveStats } {
  const { live, simulation } = splitRecorded(trades);
  const liveStats = live.length
    ? { ...buildPublicLiveStats(live, now, timeZone), book: 'live' as const, liveBookStart: LIVE_BOOK_START_ISO, emptyMessage: null, hasSimulationHistory: simulation.length > 0 }
    : emptyLiveStats(now, simulation.length > 0);
  const simStats = simulation.length
    ? { ...buildPublicLiveStats(simulation, now, timeZone), book: 'simulation' as const, liveBookStart: LIVE_BOOK_START_ISO, emptyMessage: null, hasSimulationHistory: true }
    : { ...EMPTY_PUBLIC_LIVE, asOf: now.toISOString(), book: 'simulation' as const, liveBookStart: LIVE_BOOK_START_ISO, emptyMessage: null, hasSimulationHistory: false };
  return { live: liveStats, simulation: simStats };
}

/** Re-split an older mixed payload so a stale snapshot cannot leak paper totals into the live book. */
export function booksFromMaybeMixed(stats: PublicLiveStats | null | undefined, now = new Date()): { live: PublicLiveStats; simulation: PublicLiveStats } {
  if (!stats) return buildPublicBooks([], now);
  if (stats.book === 'live' && !stats.anySimulated) {
    return {
      live: { ...stats, book: 'live', liveBookStart: LIVE_BOOK_START_ISO, emptyMessage: stats.hasData ? null : LIVE_EMPTY_MESSAGE },
      simulation: { ...EMPTY_PUBLIC_LIVE, asOf: now.toISOString(), book: 'simulation', liveBookStart: LIVE_BOOK_START_ISO, emptyMessage: null, hasSimulationHistory: false },
    };
  }
  const rows: RecordedPublicTrade[] = (stats.ticker ?? []).map((item) => ({
    id: item.id,
    at: item.at,
    symbol: item.token,
    side: item.side,
    pnlPct: item.pnlPct,
    pnlUsd: null,
    signature: item.solscan ? item.solscan.split('/').pop() ?? null : null,
    simulated: item.simulated,
    isHouse: item.trader === HOUSE_TRADER_LABEL,
  }));
  // A fully simulated (or pre-cutoff) book belongs entirely in simulation history.
  if (stats.allSimulated || rows.every((r) => !isLiveBookTrade(r))) {
    return {
      live: emptyLiveStats(now, stats.hasData || rows.length > 0),
      simulation: { ...stats, book: 'simulation', liveBookStart: LIVE_BOOK_START_ISO, emptyMessage: null, hasSimulationHistory: true },
    };
  }
  return buildPublicBooks(rows, now);
}

export function recordedFromLiveEvents(events: LiveTradeEvent[], house = true): RecordedPublicTrade[] {
  return events.filter((e) => e.kind === 'sell' || e.kind === 'sweep').map((e, i) => ({
    id: `log-${e.kind}-${e.signature ?? e.at}-${i}`,
    at: e.at,
    symbol: e.symbol,
    side: e.kind,
    pnlPct: e.pnlPct,
    pnlUsd: e.kind === 'sweep' ? null : e.pnlUsd,
    signature: e.signature,
    simulated: e.simulated,
    isHouse: house,
  }));
}

export function recordedFromClosedPositions(rows: Array<{
  id: string; symbol: string; closedAt?: Date | string | null; pnlUsd?: number | null; pnlPct?: number | null;
  exitTx?: string | null; entryTx?: string | null; simulated?: boolean; isOperator?: boolean;
  optedInLabel?: string | null; showWallet?: boolean; wallet?: string | null;
}>): RecordedPublicTrade[] {
  return rows.filter((r) => r.closedAt).map((r) => ({
    id: r.id,
    at: r.closedAt instanceof Date ? r.closedAt.toISOString() : String(r.closedAt),
    symbol: r.symbol,
    side: 'sell',
    pnlPct: r.pnlPct ?? null,
    pnlUsd: r.pnlUsd ?? null,
    signature: r.exitTx ?? r.entryTx ?? null,
    simulated: r.simulated !== false,
    isHouse: Boolean(r.isOperator),
    optedInLabel: r.optedInLabel ?? null,
    showWallet: Boolean(r.showWallet),
    wallet: r.showWallet ? (r.wallet ?? null) : null,
  }));
}

/** Deduplicate recorded trades by tx signature (or id if unsigned). */
export function mergeRecorded(a: RecordedPublicTrade[], b: RecordedPublicTrade[]): RecordedPublicTrade[] {
  const seen = new Set<string>();
  const out: RecordedPublicTrade[] = [];
  for (const t of [...a, ...b]) {
    const key = t.signature || t.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

void chicagoDay;
