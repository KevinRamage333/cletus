/**
 * Browser-local paper trading (practice desk). Pure and unit-tested; persisted by the UI in localStorage.
 * Uses the same fill model as the engine (src/lib/fills.ts) and the 0.5% platform fee so practice stays realistic.
 * Never signs or sends a transaction.
 */
import { simFillPrice } from './fills';

export const LOCAL_PAPER_KEY = 'cletus.paper.local.v1';
export const PAPER_FEE_RATE = 0.005;
export const DEFAULT_STARTING_USD = 10_000;
export const MAX_TRADE_USD = 100_000;

export interface PaperQuoteIn { mint: string; symbol: string; name?: string; imageUrl?: string | null; priceUsd: number | null; liquidityUsd: number | null }
export interface LocalPosition { mint: string; symbol: string; name: string; imageUrl: string | null; tokens: number; costUsd: number; openedAt: string }
export interface LocalTrade { id: string; side: 'buy' | 'sell'; mint: string; symbol: string; tokens: number; fillPriceUsd: number; markPriceUsd: number; notionalUsd: number; feeUsd: number; costBasisUsd: number | null; realizedPnlUsd: number | null; openedAt: string | null; at: string }
export interface LocalPaperAccount { version: 1; startingUsd: number; cashUsd: number; positions: LocalPosition[]; trades: LocalTrade[]; createdAt: string }

export type PaperResult = { ok: true; account: LocalPaperAccount; trade: LocalTrade } | { ok: false; error: string };

export function newPaperAccount(startingUsd = DEFAULT_STARTING_USD, now = new Date()): LocalPaperAccount {
  return { version: 1, startingUsd, cashUsd: startingUsd, positions: [], trades: [], createdAt: now.toISOString() };
}

const id = (now: Date, n: number) => `${now.getTime().toString(36)}-${n}`;

export function paperBuy(acct: LocalPaperAccount, q: PaperQuoteIn, usd: number, now = new Date()): PaperResult {
  if (!(q.priceUsd && q.priceUsd > 0)) return { ok: false, error: 'Price unavailable for this token right now. No trade was simulated.' };
  if (!(usd > 0) || !Number.isFinite(usd)) return { ok: false, error: 'Enter an amount greater than $0.' };
  if (usd > MAX_TRADE_USD) return { ok: false, error: `Maximum practice trade is $${MAX_TRADE_USD.toLocaleString('en-US')}.` };
  if (usd > acct.cashUsd + 1e-9) return { ok: false, error: 'Not enough paper cash.' };
  const fee = usd * PAPER_FEE_RATE;
  const fill = simFillPrice('buy', q.priceUsd, usd - fee, q.liquidityUsd);
  const tokens = (usd - fee) / fill;
  const at = now.toISOString();
  const existing = acct.positions.find((p) => p.mint === q.mint);
  const positions = existing
    ? acct.positions.map((p) => (p.mint === q.mint ? { ...p, tokens: p.tokens + tokens, costUsd: p.costUsd + usd } : p))
    : [...acct.positions, { mint: q.mint, symbol: q.symbol, name: q.name ?? q.symbol, imageUrl: q.imageUrl ?? null, tokens, costUsd: usd, openedAt: at }];
  const trade: LocalTrade = { id: id(now, acct.trades.length), side: 'buy', mint: q.mint, symbol: q.symbol, tokens, fillPriceUsd: fill, markPriceUsd: q.priceUsd, notionalUsd: usd, feeUsd: fee, costBasisUsd: null, realizedPnlUsd: null, openedAt: existing?.openedAt ?? at, at };
  return { ok: true, account: { ...acct, cashUsd: acct.cashUsd - usd, positions, trades: [...acct.trades, trade] }, trade };
}

/** Sell a fraction (0..1] of a position at the current price. Realized P&L uses average cost and includes fees. */
export function paperSell(acct: LocalPaperAccount, q: PaperQuoteIn, fraction: number, now = new Date()): PaperResult {
  const pos = acct.positions.find((p) => p.mint === q.mint);
  if (!pos) return { ok: false, error: 'No open paper position in this token.' };
  if (!(q.priceUsd && q.priceUsd > 0)) return { ok: false, error: 'Price unavailable for this token right now. No trade was simulated.' };
  if (!(fraction > 0 && fraction <= 1)) return { ok: false, error: 'Choose how much to sell.' };
  const tokens = fraction >= 1 ? pos.tokens : pos.tokens * fraction;
  const grossMark = tokens * q.priceUsd;
  const fill = simFillPrice('sell', q.priceUsd, grossMark, q.liquidityUsd);
  const gross = tokens * fill;
  const fee = gross * PAPER_FEE_RATE;
  const proceeds = gross - fee;
  const basis = pos.costUsd * (tokens / pos.tokens);
  const pnl = proceeds - basis;
  const remaining = pos.tokens - tokens;
  const positions = remaining <= pos.tokens * 1e-9 ? acct.positions.filter((p) => p.mint !== q.mint) : acct.positions.map((p) => (p.mint === q.mint ? { ...p, tokens: remaining, costUsd: p.costUsd - basis } : p));
  const trade: LocalTrade = { id: id(now, acct.trades.length), side: 'sell', mint: q.mint, symbol: pos.symbol, tokens, fillPriceUsd: fill, markPriceUsd: q.priceUsd, notionalUsd: proceeds, feeUsd: fee, costBasisUsd: basis, realizedPnlUsd: pnl, openedAt: pos.openedAt, at: now.toISOString() };
  return { ok: true, account: { ...acct, cashUsd: acct.cashUsd + proceeds, positions, trades: [...acct.trades, trade] }, trade };
}

export interface Valuation { positionsValueUsd: number | null; equityUsd: number | null; unrealizedPnlUsd: number | null; realizedPnlUsd: number; unpricedMints: string[] }
/** Mark positions to market. If any position has no price, totals that depend on it are null (unknown), never $0. */
export function valueAccount(acct: LocalPaperAccount, prices: Record<string, number | null | undefined>): Valuation {
  const unpriced = acct.positions.filter((p) => !(prices[p.mint] && (prices[p.mint] as number) > 0)).map((p) => p.mint);
  const realized = acct.trades.reduce((s, t) => s + (t.realizedPnlUsd ?? 0), 0);
  if (unpriced.length) return { positionsValueUsd: null, equityUsd: null, unrealizedPnlUsd: null, realizedPnlUsd: realized, unpricedMints: unpriced };
  const value = acct.positions.reduce((s, p) => s + p.tokens * (prices[p.mint] as number), 0);
  const cost = acct.positions.reduce((s, p) => s + p.costUsd, 0);
  return { positionsValueUsd: value, equityUsd: acct.cashUsd + value, unrealizedPnlUsd: value - cost, realizedPnlUsd: realized, unpricedMints: [] };
}

/** Defensive parse of stored JSON; corrupt data yields null so the UI can offer a reset. */
export function parseAccount(raw: string | null): LocalPaperAccount | null {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as LocalPaperAccount;
    if (a?.version !== 1 || !Array.isArray(a.positions) || !Array.isArray(a.trades) || !Number.isFinite(a.cashUsd)) return null;
    return a;
  } catch { return null; }
}

export interface TaxLot { date: string; symbol: string; mint: string; acquired: string | null; proceedsUsd: number; costBasisUsd: number; gainUsd: number; term: 'short' | 'long' | 'unknown' }
export function realizedLots(acct: LocalPaperAccount): TaxLot[] {
  return acct.trades.filter((t) => t.side === 'sell' && t.costBasisUsd != null && t.realizedPnlUsd != null).map((t) => {
    const held = t.openedAt ? Date.parse(t.at) - Date.parse(t.openedAt) : NaN;
    return { date: t.at, symbol: t.symbol, mint: t.mint, acquired: t.openedAt, proceedsUsd: t.notionalUsd, costBasisUsd: t.costBasisUsd as number, gainUsd: t.realizedPnlUsd as number, term: Number.isFinite(held) ? (held > 365 * 86400_000 ? 'long' : 'short') : 'unknown' };
  });
}
const csvCell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; };
export function lotsToCsv(lots: TaxLot[]): string {
  const head = ['Date sold', 'Asset', 'Mint', 'Date acquired', 'Proceeds (USD)', 'Cost basis (USD)', 'Gain/loss (USD)', 'Term', 'Note'];
  const rows = lots.map((l) => [l.date, l.symbol, l.mint, l.acquired ?? '', l.proceedsUsd.toFixed(2), l.costBasisUsd.toFixed(2), l.gainUsd.toFixed(2), l.term, 'SIMULATED paper trade - not a taxable event']);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
