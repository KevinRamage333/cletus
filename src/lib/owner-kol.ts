/** Owner desk: KOL add-on view (wallet balance, last scan round, open KOL positions, KOL trade history with P&L). */
import { KOL_TRADING_WALLET } from './owner-withdraw-queue';
import { solscanAccountUrl, solscanTxUrl } from './approvals';
import { curveFromClosed, enrichPosition, sumKnown, sumTodayPnl, winLoss, type LiveWatchModel } from './live-watch';

export interface KolDeskPosition { id: string; symbol: string; mint: string; entryPrice: number; lastPrice: number; sizeUsd: number; valueUsd: number; pnlUsd: number; pnlPct: number; openedAt: string }
export interface KolDeskTrade { id: string; symbol: string; mint: string; openedAt: string; closedAt: string | null; sizeUsd: number; pnlUsd: number; pnlPct: number; exitReason: string | null; exitTxUrl: string | null }
export interface KolDesk {
  enabled: boolean; source: string; wallet: string;
  sol: number | null; usd: number | null;
  round: { at: string | null; summary: string; rows: Array<{ mint: string; symbol: string; mcapUsd: number | null; via: string; decision: string; reason: string }> };
  open: KolDeskPosition[];
  history: KolDeskTrade[];
  totals: { trades: number; wins: number; pnlUsd: number };
}

export function kolTotals(h: KolDeskTrade[]) {
  return { trades: h.length, wins: h.filter((t) => t.pnlUsd > 0).length, pnlUsd: Math.round(h.reduce((s, t) => s + t.pnlUsd, 0) * 100) / 100 };
}

export function emptyKolDesk(): KolDesk {
  return {
    enabled: true, source: 'hype', wallet: KOL_TRADING_WALLET, sol: null, usd: null,
    round: { at: null, summary: '', rows: [] }, open: [], history: [], totals: { trades: 0, wins: 0, pnlUsd: 0 },
  };
}

export interface CombinedWallets {
  sol: number | null;
  usd: number | null;
  realizedPnl: number | null;
  totalPnl: number | null;
  openPositions: number;
  mainSol: number | null;
  kolSol: number | null;
  mainUsd: number | null;
  kolUsd: number | null;
}

export function combinedWallets(
  main: { sol?: number | null; equityUsd?: number | null; realizedPnl?: number | null; totalPnl?: number | null; openAll?: unknown[]; open?: unknown },
  kol: KolDesk | null | undefined,
): CombinedWallets {
  const mainSol = main.sol ?? null;
  const kolSol = kol?.sol ?? null;
  const mainUsd = main.equityUsd ?? null;
  const kolUsd = kol?.usd ?? null;
  // With a KOL desk present, a combined figure needs both sides; a missing side is unknown, not $0.
  // Without a desk (kol null/undefined) the combined figure is the main wallet alone.
  const add = (a: number | null, b: number | null) => (a == null ? null : kol ? (b == null ? null : a + b) : a);
  // Unknown main-wallet P&L stays unknown in the combined figures (no $0 or realized-only stand-in).
  const kolRealized = kol?.totals.pnlUsd ?? 0;
  const realized = main.realizedPnl == null ? null : main.realizedPnl + kolRealized;
  const unrealized = sumKnown((kol?.open ?? []).map((p) => (Number.isFinite(p.pnlUsd) ? p.pnlUsd : null)));
  const mainTotal = main.totalPnl ?? null;
  const openPositions = (main.openAll?.length ?? (main.open ? 1 : 0)) + (kol?.open.length ?? 0);
  return {
    sol: add(mainSol, kolSol),
    usd: (() => { const v = add(mainUsd, kolUsd); return v == null ? null : Math.round(v * 100) / 100; })(),
    realizedPnl: realized === null ? null : Math.round(realized * 100) / 100,
    totalPnl: mainTotal === null || unrealized === null ? null : Math.round((mainTotal + kolRealized + unrealized) * 100) / 100,
    openPositions,
    mainSol, kolSol, mainUsd, kolUsd,
  };
}

/** Map the KOL desk into the same LiveWatch model the main wallet section uses. Does not invent trades. */
export function kolWatchFromDesk(kol: KolDesk, opts?: { halted?: boolean; solPriceUsd?: number | null; asOf?: string }): LiveWatchModel {
  const openAll = kol.open.map((p) => enrichPosition({
    id: p.id, symbol: p.symbol, mint: p.mint, sizeUsd: p.sizeUsd,
    entryPrice: p.entryPrice, lastPrice: p.lastPrice, pnlUsd: p.pnlUsd, pnlPct: p.pnlPct,
    openedAt: p.openedAt, solscanMint: solscanAccountUrl(p.mint), simulated: false,
  }, 7, 15));
  const feed = kol.history.map((h) => ({
    id: h.id, kind: 'sell' as const, at: h.closedAt ?? h.openedAt, symbol: h.symbol, mint: h.mint,
    sizeUsd: h.sizeUsd, pnlUsd: h.pnlUsd, pnlPct: h.pnlPct, reason: h.exitReason,
    win: h.pnlUsd > 0, solscan: h.exitTxUrl, solscanMint: solscanAccountUrl(h.mint), simulated: false,
  })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const wl = winLoss(feed);
  const realized = kol.totals.pnlUsd;
  const unrealized = sumKnown(openAll.map((p) => p.pnlUsd));
  const equity = kol.usd;
  const start = equity == null || unrealized === null ? 0 : Math.round((equity - realized - unrealized) * 100) / 100;
  const hasBook = feed.length > 0 || openAll.length > 0;
  return {
    asOf: opts?.asOf ?? new Date().toISOString(),
    mode: 'live',
    scope: 'owner',
    label: 'KOL / pump.fun wallet',
    equityUsd: equity,
    sol: kol.sol,
    solPriceUsd: opts?.solPriceUsd ?? null,
    realizedPnl: realized,
    unrealizedPnl: unrealized === null ? null : Math.round(unrealized * 100) / 100,
    totalPnl: unrealized === null ? null : Math.round((realized + unrealized) * 100) / 100,
    todayPnl: sumTodayPnl(feed.map((t) => ({ pnlUsd: t.pnlUsd, at: t.at }))),
    winRate: wl.winRate,
    wins: wl.wins,
    losses: wl.losses,
    closedTrades: feed.length,
    open: openAll[0] ?? null,
    openAll,
    feed,
    equityCurve: hasBook || equity != null ? curveFromClosed(start, feed.map((t) => ({ at: t.at, pnlUsd: t.pnlUsd })), equity) : [],
    halted: opts?.halted ?? false,
    chartApiBase: '/api/owner/chart',
    simulatedBadge: false,
    book: 'live',
    emptyMessage: hasBook ? null : 'No KOL trades yet.',
    walletAddress: kol.wallet,
  };
}


/** Box-only (needs Postgres, the plan store and engine memory). */
export async function buildKolDesk(): Promise<KolDesk> {
  const { kolConfig } = await import('./kol-mode');
  const { kolPositionIds } = await import('./exit-plan-store');
  const { getKolRound } = await import('./kol-hype');
  const { prisma } = await import('./db');
  const { mem } = await import('./engine');
  const kc = kolConfig(process.env);
  const ids = kolPositionIds();
  const rows = ids.length ? await prisma.position.findMany({ where: { id: { in: ids } }, orderBy: { openedAt: 'desc' }, take: 100 }) : [];
  const open: KolDeskPosition[] = rows.filter((p) => p.status === 'open').map((p) => {
    const px = mem.prices.get(p.mint) ?? p.lastPrice;
    const value = p.tokenAmount * px;
    const pnl = value - p.sizeUsd;
    return { id: p.id, symbol: p.symbol, mint: p.mint, entryPrice: p.entryPrice, lastPrice: px, sizeUsd: p.sizeUsd, valueUsd: value, pnlUsd: pnl, pnlPct: p.sizeUsd > 0 ? (pnl / p.sizeUsd) * 100 : 0, openedAt: p.openedAt.toISOString() };
  });
  const history: KolDeskTrade[] = rows.filter((p) => p.status === 'closed').map((p) => ({
    id: p.id, symbol: p.symbol, mint: p.mint, openedAt: p.openedAt.toISOString(), closedAt: p.closedAt?.toISOString() ?? null,
    sizeUsd: p.sizeUsd, pnlUsd: p.pnlUsd ?? 0, pnlPct: p.pnlPct ?? 0, exitReason: p.exitReason, exitTxUrl: p.exitTx ? solscanTxUrl(p.exitTx) : null,
  }));
  return { enabled: kc.enabled, source: kc.source, wallet: KOL_TRADING_WALLET, sol: null, usd: null, round: getKolRound(), open, history, totals: kolTotals(history) };
}
