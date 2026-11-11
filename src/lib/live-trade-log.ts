/**
 * Append-only live trade event log for the box worker.
 * One JSON object per line at logs/live-trades.jsonl (or LIVE_TRADES_LOG).
 * Compatible with the owner-dashboard reader in live-trades.ts.
 * Never throws, never logs secrets.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_LIVE_TRADES_PATH = '/workspace/cletus/logs/live-trades.jsonl';

export function liveTradesPath(): string {
  return process.env.LIVE_TRADES_LOG?.trim() || DEFAULT_LIVE_TRADES_PATH;
}

export interface LiveTradeLogEvent {
  type: 'buy' | 'sell' | 'sweep';
  at?: string;
  token?: string;
  symbol?: string;
  mint?: string | null;
  side: 'buy' | 'sell' | 'sweep';
  sizeUsd?: number | null;
  price?: number | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  pnlUsd?: number | null;
  pnlPct?: number | null;
  signature?: string | null;
  equityUsd?: number | null;
  reason?: string | null;
  simulated?: boolean;
}

export function appendLiveTrade(event: LiveTradeLogEvent): void {
  try {
    const file = liveTradesPath();
    mkdirSync(path.dirname(file), { recursive: true });
    const line = JSON.stringify({
      ...event,
      at: event.at || new Date().toISOString(),
    }) + '\n';
    appendFileSync(file, line);
  } catch {
    /* logging must never crash the engine */
  }
}
