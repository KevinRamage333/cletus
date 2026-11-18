/** Pure helpers for the live charts (unit-tested). Real data only; nothing here invents prices or P&L. */
export const CHART_RANGES = ['1H', '4H', '1D', '1W'] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
export const CHART_REFRESH_MS: Record<ChartRange, number> = { '1H': 15_000, '4H': 20_000, '1D': 30_000, '1W': 120_000 };
export const GAIN = '#22c55e';
export const LOSS = '#ef4444';

export const normRange = (r: string | null | undefined): ChartRange => {
  const u = String(r ?? '').toUpperCase();
  return (CHART_RANGES as readonly string[]).includes(u) ? (u as ChartRange) : '1H';
};

/** Symbol query guard for the public chart endpoint: short ticker-like text only. */
export const SYMBOL_QUERY = /^[A-Za-z0-9$._-]{1,20}$/;

export interface PnlPoint { time: number; value: number }

/** Distinct accounts a community chart point must aggregate before it is shown (privacy floor). */
export const MIN_ACCOUNTS_PER_POINT = 5;

/**
 * Closed trades -> cumulative realized P&L, one point per bucket (default one day, UTC).
 * With `minAccounts`, a bucket is only emitted once it (plus any held-back earlier buckets) covers at least that many
 * distinct accounts; quieter buckets roll forward into the next point, so one member's P&L is never a point of its own.
 * Rows without an accountId count as unknown and never satisfy the floor on their own.
 */
export function cumulativePnlSeries(rows: Array<{ closedAt: Date | string | null | undefined; pnlUsd: number | null | undefined; accountId?: string | null }>, bucketSec = 86_400, minAccounts = 0): PnlPoint[] {
  const byBucket = new Map<number, { sum: number; accounts: Set<string> }>();
  for (const r of rows) {
    if (!r.closedAt || r.pnlUsd == null || !Number.isFinite(r.pnlUsd)) continue;
    const t = Math.floor(new Date(r.closedAt).getTime() / 1000);
    if (!Number.isFinite(t)) continue;
    const b = Math.floor(t / bucketSec) * bucketSec;
    const cur = byBucket.get(b) ?? { sum: 0, accounts: new Set<string>() };
    cur.sum += r.pnlUsd;
    if (r.accountId) cur.accounts.add(r.accountId);
    byBucket.set(b, cur);
  }
  let run = 0;
  let pendingSum = 0;
  let pending = new Set<string>();
  const out: PnlPoint[] = [];
  for (const [time, v] of [...byBucket.entries()].sort((a, b) => a[0] - b[0])) {
    pendingSum += v.sum;
    for (const a of v.accounts) pending.add(a);
    if (minAccounts > 0 && pending.size < minAccounts) continue;
    run += pendingSum;
    out.push({ time, value: Math.round(run * 100) / 100 });
    pendingSum = 0; pending = new Set<string>();
  }
  return out;
}

/** Most-traded token by number of positions (ties: most recent symbol order kept stable by mint). */
export function mostTradedToken(rows: Array<{ mint: string; symbol: string | null | undefined; network?: string | null }>, network = 'solana'): { mint: string; symbol: string; trades: number } | null {
  const counts = new Map<string, { symbol: string; trades: number }>();
  for (const r of rows) {
    if (!r.mint || (r.network ?? 'solana').toLowerCase() !== network) continue;
    const c = counts.get(r.mint) ?? { symbol: r.symbol || r.mint.slice(0, 4), trades: 0 };
    c.trades += 1; counts.set(r.mint, c);
  }
  let best: { mint: string; symbol: string; trades: number } | null = null;
  for (const [mint, c] of counts) if (!best || c.trades > best.trades || (c.trades === best.trades && mint < best.mint)) best = { mint, ...c };
  return best;
}

/** Up/down tone for a change value: gains green, losses red. */
export const toneOf = (n: number | null | undefined): 'up' | 'down' | 'flat' => (n == null || !Number.isFinite(n) || n === 0 ? 'flat' : n > 0 ? 'up' : 'down');

/** Chart axis labels in the viewer's own time zone (lightweight-charts defaults to UTC). */
export const localTime = (t: unknown): string => new Date(Number(t) * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const localTick = (t: unknown, kind: number): string => {
  const d = new Date(Number(t) * 1000);
  return kind <= 0 ? String(d.getFullYear()) : kind === 1 ? d.toLocaleDateString([], { month: 'short' }) : kind === 2 ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
