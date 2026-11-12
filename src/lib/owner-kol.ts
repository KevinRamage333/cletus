/** Owner desk: KOL add-on view (wallet balance, last scan round, open KOL positions, KOL trade history with P&L). */
import { KOL_TRADING_WALLET } from './owner-withdraw-queue';
import { solscanTxUrl } from './approvals';

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
