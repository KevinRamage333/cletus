/**
 * Reader for the box live-trade log written by the worker:
 * /workspace/cletus/logs/live-trades.jsonl  (one JSON object per buy/sell/sweep).
 * The schema is best-effort — unknown fields are ignored, missing fields get defaults.
 */
import { readFileSync, existsSync } from 'fs';
import { solscanTxUrl, solscanAccountUrl } from './approvals';

export const DEFAULT_LIVE_TRADES_PATH = 'logs/live-trades.jsonl';

export type LiveTradeKind = 'buy' | 'sell' | 'sweep';

export interface LiveTradeEvent {
  kind: LiveTradeKind;
  at: string;
  symbol: string;
  mint: string | null;
  sizeUsd: number | null;
  price: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  reason: string | null;
  signature: string | null;
  solscan: string | null;
  solscanMint: string | null;
  equityUsd: number | null;
  simulated: boolean;
  raw: Record<string, unknown>;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function parseLiveTradeLine(line: string): LiveTradeEvent | null {
  const t = line.trim();
  if (!t || t.startsWith('#')) return null;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(t) as Record<string, unknown>; } catch { return null; }
  const type = String(raw.type ?? raw.kind ?? raw.side ?? raw.event ?? '').toLowerCase();
  let kind: LiveTradeKind | null = null;
  if (type === 'buy' || type === 'open' || type === 'entry') kind = 'buy';
  else if (type === 'sell' || type === 'close' || type === 'exit') kind = 'sell';
  else if (type === 'sweep' || type === 'payout' || type === 'profit_sweep') kind = 'sweep';
  if (!kind) return null;
  const mint = str(raw.mint ?? raw.token ?? raw.address);
  const signature = str(raw.signature ?? raw.sig ?? raw.tx ?? raw.entryTx ?? raw.exitTx);
  const at = str(raw.at ?? raw.ts ?? raw.time ?? raw.closedAt ?? raw.openedAt) ?? new Date().toISOString();
  return {
    kind,
    at,
    symbol: str(raw.symbol ?? raw.ticker ?? raw.name) ?? (mint ? mint.slice(0, 4) : kind === 'sweep' ? 'SOL' : 'TOKEN'),
    mint,
    sizeUsd: num(raw.sizeUsd ?? raw.size ?? raw.amountUsd ?? raw.usd),
    price: num(raw.price ?? raw.lastPrice ?? raw.exitPrice ?? raw.entryPrice),
    entryPrice: num(raw.entryPrice ?? raw.entry),
    exitPrice: num(raw.exitPrice ?? raw.exit),
    pnlUsd: num(raw.pnlUsd ?? raw.pnl),
    pnlPct: num(raw.pnlPct),
    stopLoss: num(raw.stopLoss ?? raw.sl ?? raw.stopLossPrice),
    takeProfit: num(raw.takeProfit ?? raw.tp ?? raw.takeProfitPrice),
    reason: str(raw.reason ?? raw.exitReason ?? raw.note),
    signature,
    solscan: solscanTxUrl(signature),
    solscanMint: solscanAccountUrl(mint),
    equityUsd: num(raw.equityUsd ?? raw.equity),
    simulated: raw.simulated === true || raw.live === false,
    raw,
  };
}

export function parseLiveTrades(text: string): LiveTradeEvent[] {
  const out: LiveTradeEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const ev = parseLiveTradeLine(line);
    if (ev) out.push(ev);
  }
  return out;
}

export function readLiveTrades(path = process.env.LIVE_TRADES_PATH || DEFAULT_LIVE_TRADES_PATH): LiveTradeEvent[] {
  try {
    if (!existsSync(path)) return [];
    return parseLiveTrades(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
}

export function todayPnl(events: LiveTradeEvent[], now = new Date(), timeZone = 'America/Chicago'): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  let sum = 0;
  for (const e of events) {
    if (e.kind !== 'sell' || e.pnlUsd === null) continue;
    const d = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(e.at));
    if (d === day) sum += e.pnlUsd;
  }
  return Math.round(sum * 100) / 100;
}

export function realizedPnl(events: LiveTradeEvent[]): number {
  return Math.round(events.filter((e) => e.kind === 'sell' && e.pnlUsd !== null).reduce((s, e) => s + (e.pnlUsd ?? 0), 0) * 100) / 100;
}

/** Equity curve from events that carry equityUsd, else reconstructed from starting equity + cumulative sell PnL. */
export function equityCurveFromEvents(events: LiveTradeEvent[], startingEquityUsd: number): Array<{ t: string; equityUsd: number }> {
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const out: Array<{ t: string; equityUsd: number }> = [];
  if (startingEquityUsd > 0) {
    const first = sorted[0];
    out.push({ t: first ? new Date(Date.parse(first.at) - 1000).toISOString() : new Date().toISOString(), equityUsd: startingEquityUsd });
  }
  let eq = startingEquityUsd;
  for (const e of sorted) {
    if (e.equityUsd !== null) eq = e.equityUsd;
    else if (e.kind === 'sell' && e.pnlUsd !== null) eq = Math.round((eq + e.pnlUsd) * 100) / 100;
    else if (e.kind === 'sweep' && e.sizeUsd !== null) eq = Math.round((eq - e.sizeUsd) * 100) / 100;
    else continue;
    out.push({ t: e.at, equityUsd: eq });
  }
  return out;
}
