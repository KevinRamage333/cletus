/** Community overview shaping (pure; unit-tested). Aggregates only — no individual data. */
export const COMMUNITY_NETWORKS = [
  { id: 'solana', name: 'Solana', symbol: 'SOL', walletConnect: true, marketData: true, paperTrading: true },
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', walletConnect: true, marketData: false, paperTrading: false },
  { id: 'base', name: 'Base', symbol: 'ETH', walletConnect: true, marketData: false, paperTrading: false },
  { id: 'bnb', name: 'BNB Chain', symbol: 'BNB', walletConnect: true, marketData: false, paperTrading: false },
  { id: 'polygon', name: 'Polygon', symbol: 'POL', walletConnect: true, marketData: false, paperTrading: false },
  { id: 'cronos', name: 'Cronos', symbol: 'CRO', walletConnect: true, marketData: false, paperTrading: false },
] as const;
export const MIN_CONTRIBUTORS = 5;

export function tokensPerNetwork(rows: Array<{ network: string; mint: string }>): Record<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const r of rows) { const n = (r.network || 'solana').toLowerCase(); if (!sets.has(n)) sets.set(n, new Set()); sets.get(n)!.add(r.mint); }
  return Object.fromEntries(COMMUNITY_NETWORKS.map((n) => [n.id, sets.get(n.id)?.size ?? 0]));
}

export type CommunityPnlRow = {
  closedAt: Date | string | null | undefined; pnlUsd: number | null | undefined; accountId: string | null | undefined;
  /** When the member became eligible (see memberEligibleFrom). Trades closed before it never count; null = not eligible. Omitted = no gate. */
  eligibleFrom?: Date | string | null;
};
export type PublishedCommunityPnl =
  | { suppressed: true; minContributors: number; series: [] }
  | {
      suppressed: false;
      /** Whole dollars. Always equals the last point of `series`: totals and chart come from the same trades. */
      netUsd: number;
      closedTrades: number;
      contributors: number;
      /** Both sides of the split are null unless each side has at least MIN_CONTRIBUTORS distinct people (otherwise net minus one side reveals the other). */
      gainsUsd: number | null;
      lossesUsd: number | null;
      winningTrades: number | null;
      losingTrades: number | null;
      series: Array<{ time: number; value: number }>;
    };

const wholeDollars = (n: number) => Math.round(n) || 0;

/**
 * The only collective P&L the community may see (L-103a).
 * Closed trades are bucketed (one UTC day by default). Only finished buckets are considered (never the one containing
 * `now`), so a published day can't change as new trades close. A finished bucket is only published once it, plus any
 * held-back earlier buckets, covers MIN_CONTRIBUTORS distinct accounts. Every published figure (net, trade count and
 * the split) is computed from exactly the published buckets, so "total minus last chart point" is never a held-back
 * trade, and figures only change when a new finished day with 5+ members is released.
 * The gains/losses split is all-or-nothing: if either side has fewer than MIN_CONTRIBUTORS people, both are hidden.
 * Rows closed before the member's eligibleFrom are ignored, so a newly eligible member never changes past days.
 * Figures are rounded to whole dollars. Rows without a P&L, close time or account are ignored, not counted as $0.
 * Known residual: a member who opts out, is banned or is anonymised leaves the aggregate, which changes past figures.
 */
export function publishedCommunityPnl(rows: CommunityPnlRow[], bucketSec = 86_400, minPeople = MIN_CONTRIBUTORS, now: Date = new Date()): PublishedCommunityPnl {
  const openBucket = Math.floor(now.getTime() / 1000 / bucketSec) * bucketSec;
  type Bucket = { rows: Array<{ pnl: number; accountId: string }>; accounts: Set<string> };
  const byBucket = new Map<number, Bucket>();
  for (const r of rows) {
    if (!r.closedAt || r.pnlUsd == null || !Number.isFinite(r.pnlUsd) || !r.accountId) continue;
    const t = Math.floor(new Date(r.closedAt).getTime() / 1000);
    if (!Number.isFinite(t)) continue;
    if (r.eligibleFrom !== undefined) {
      const from = r.eligibleFrom === null ? NaN : new Date(r.eligibleFrom).getTime() / 1000;
      if (!Number.isFinite(from) || t < from) continue; // not eligible yet when this trade closed
    }
    const b = Math.floor(t / bucketSec) * bucketSec;
    if (b >= openBucket) continue; // today's (unfinished) bucket is never published
    const cur = byBucket.get(b) ?? { rows: [], accounts: new Set<string>() };
    cur.rows.push({ pnl: r.pnlUsd, accountId: r.accountId });
    cur.accounts.add(r.accountId);
    byBucket.set(b, cur);
  }
  const published: Array<{ pnl: number; accountId: string }> = [];
  const series: Array<{ time: number; value: number }> = [];
  let pending: Array<{ pnl: number; accountId: string }> = [];
  let pendingAccounts = new Set<string>();
  let run = 0;
  for (const [time, v] of [...byBucket.entries()].sort((a, b) => a[0] - b[0])) {
    pending = pending.concat(v.rows);
    for (const a of v.accounts) pendingAccounts.add(a);
    if (pendingAccounts.size < minPeople) continue; // held back: rolls into the next published point
    for (const r of pending) { run += r.pnl; published.push(r); }
    series.push({ time, value: wholeDollars(run) });
    pending = []; pendingAccounts = new Set<string>();
  }
  const contributors = new Set(published.map((r) => r.accountId)).size;
  if (!series.length || contributors < minPeople) return { suppressed: true, minContributors: minPeople, series: [] };
  const wins = published.filter((r) => r.pnl > 0);
  const losses = published.filter((r) => r.pnl < 0);
  const people = (part: typeof published) => new Set(part.map((r) => r.accountId)).size;
  // All or nothing: one visible side plus net and trade count would reveal the hidden side by subtraction.
  const split = people(wins) >= minPeople && people(losses) >= minPeople;
  return {
    suppressed: false,
    netUsd: series[series.length - 1].value,
    closedTrades: published.length,
    contributors,
    gainsUsd: split ? wholeDollars(wins.reduce((s, r) => s + r.pnl, 0)) : null,
    lossesUsd: split ? wholeDollars(losses.reduce((s, r) => s + r.pnl, 0)) : null,
    winningTrades: split ? wins.length : null,
    losingTrades: split ? losses.length : null,
    series,
  };
}
