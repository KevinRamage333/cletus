/**
 * Trade journal (flag TRADE_JOURNAL=on, default off). Logging only: it never trades, sizes, or blocks a fill.
 * One JSON line per event at logs/trade-journal.jsonl (TRADE_JOURNAL_PATH):
 *   entry: the "why" — score, threshold, weight set, the 8 classic signals AND the 6 liquidity-score terms,
 *          mcap, liquidity, volume, age, volatility, market mood, size, quoted vs filled price, the exit plan chosen.
 *   exit:  the "what" — exit reason, hold time, MFE/MAE, fees, exit slippage vs the observed price, P&L, partials.
 * Entries and exits are joined by positionId (readJournalTrades). Every write is wrapped so a disk error can never
 * reach the trading path.
 */
import fs from 'node:fs';
import path from 'node:path';

export const journalOn = () => ['on', 'true', '1'].includes((process.env.TRADE_JOURNAL ?? '').toLowerCase());
export const journalPath = () => process.env.TRADE_JOURNAL_PATH?.trim() || path.join(process.env.CLETUS_ROOT ?? process.cwd(), 'logs', 'trade-journal.jsonl');

export interface JournalEntryEvent {
  event: 'entry'; v: 1; at: string; positionId: string; accountId: string; book: 'live' | 'paper'; labPreset: string | null;
  symbol: string; mint: string;
  score: number; threshold: number; weightSet: string; liquidityWeights: Record<string, number> | null;
  signals: Record<string, number>;
  /** The 6 liquidity-score inputs (liquidityBuild, velocitySurge, volumePersistence, freshness, antiChase, dipInUptrend). */
  terms: Record<string, number> | null;
  mcapUsd: number; liquidityUsd: number | null; volume24hUsd: number; ageHours: number | null;
  priceChangeH1: number; priceChangeH24: number | null; volPctPerHour: number | null;
  regime: { label: string; medianH1: number; breadth: number; n: number } | null;
  sizeUsd: number; feesUsd: number; quotePrice: number; fillPrice: number; entrySlippagePct: number | null;
  exitPlan: Record<string, unknown> | null;
}
export interface JournalExitEvent {
  event: 'exit'; v: 1; at: string; positionId: string; book: 'live' | 'paper'; symbol: string;
  reason: string; holdMin: number; mfePct: number; maePct: number;
  feesUsd: number; observedPrice: number; exitPrice: number; exitSlippagePct: number | null;
  costUsd: number; pnlUsd: number; pnlPct: number; partialsTaken: number; partialPnlUsd: number;
}
export type JournalEvent = JournalEntryEvent | JournalExitEvent;
export type JournalTrade = { entry: JournalEntryEvent; exit: JournalExitEvent | null };

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/** Signed slippage in % (positive = worse for us). Buy: paid above quote. Sell: received below the observed price. */
export function slippagePct(side: 'buy' | 'sell', ref: number, fill: number): number | null {
  if (!fin(ref) || !fin(fill) || ref <= 0 || fill <= 0) return null;
  return r(side === 'buy' ? (fill / ref - 1) * 100 : (1 - fill / ref) * 100, 3);
}

/** Excursions in % of entry from the highest and lowest prices seen while open (MAE as a positive number). */
export function excursions(entry: number, highest: number, lowest: number, exitObserved: number): { mfePct: number; maePct: number } {
  if (!(entry > 0)) return { mfePct: 0, maePct: 0 };
  const hi = Math.max(highest || entry, exitObserved || 0, entry);
  const lo = Math.min(lowest || entry, exitObserved > 0 ? exitObserved : entry, entry);
  return { mfePct: r((hi / entry - 1) * 100, 3), maePct: r(Math.max(0, (1 - lo / entry) * 100), 3) };
}

export function appendJournal(ev: JournalEvent, file = journalPath()): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(ev) + '\n');
    return true;
  } catch { return false; }
}

/** Lowest price seen per open position (paper + live), so MAE exists for every trade. Cheap, in memory. */
const lows = new Map<string, number>();
export function noteLow(positionId: string, price: number): void {
  if (!journalOn() || !(price > 0)) return;
  const cur = lows.get(positionId);
  if (cur === undefined || price < cur) lows.set(positionId, price);
}
export function takeLow(positionId: string): number | undefined { const v = lows.get(positionId); lows.delete(positionId); return v; }

export function readJournal(file = journalPath()): JournalEvent[] {
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out: JournalEvent[] = [];
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line); if (e && (e.event === 'entry' || e.event === 'exit') && typeof e.positionId === 'string') out.push(e); } catch { /* skip a torn line */ }
  }
  return out;
}

/** Join entry + exit by positionId (last write wins for duplicates). */
export function readJournalTrades(events: JournalEvent[] = readJournal()): JournalTrade[] {
  const m = new Map<string, JournalTrade>();
  for (const e of events) if (e.event === 'entry') m.set(e.positionId, { entry: e, exit: m.get(e.positionId)?.exit ?? null });
  for (const e of events) if (e.event === 'exit') { const t = m.get(e.positionId); if (t) t.exit = e; }
  return [...m.values()];
}
