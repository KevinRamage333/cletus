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

export type CommunityPnlRow = { closedAt: Date | string | null | undefined; pnlUsd: number | null | undefined; accountId: string | null | undefined };
export type PublishedCommunityPnl =
  | { suppressed: true; minContributors: number; series: [] }
  | {
      suppressed: false;
      /** Whole dollars. Always equals the last point of `series`: totals and chart come from the same trades. */
      netUsd: number;
      closedTrades: number;
      contributors: number;
      /** Each side of the split is null unless at least MIN_CONTRIBUTORS distinct people are in it. */
      gainsUsd: number | null;
      lossesUsd: number | null;
      winningTrades: number | null;
      losingTrades: number | null;
      series: Array<{ time: number; value: number }>;
    };

const wholeDollars = (n: number) => Math.round(n) || 0;

/**
 * The only collective P&L the community may see (L-103a).
 * Closed trades are bucketed (one UTC day by default) and a bucket is only published once it, plus any held-back
 * earlier buckets, covers MIN_CONTRIBUTORS distinct accounts. Every published figure (net, trade count and the split)
 * is computed from exactly the published buckets, so "total minus last chart point" and "total now minus total
 * before" always cover at least MIN_CONTRIBUTORS people and can never isolate one member's trades.
 * Figures are rounded to whole dollars. Rows without a P&L, close time or account are ignored, not counted as $0.
 */
export function publishedCommunityPnl(rows: CommunityPnlRow[], bucketSec = 86_400, minPeople = MIN_CONTRIBUTORS): PublishedCommunityPnl {
  type Bucket = { rows: Array<{ pnl: number; accountId: string }>; accounts: Set<string> };
  const byBucket = new Map<number, Bucket>();
  for (const r of rows) {
    if (!r.closedAt || r.pnlUsd == null || !Number.isFinite(r.pnlUsd) || !r.accountId) continue;
    const t = Math.floor(new Date(r.closedAt).getTime() / 1000);
    if (!Number.isFinite(t)) continue;
    const b = Math.floor(t / bucketSec) * bucketSec;
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
  const floor = <T,>(part: typeof published, value: T): T | null => (new Set(part.map((r) => r.accountId)).size >= minPeople ? value : null);
  return {
    suppressed: false,
    netUsd: series[series.length - 1].value,
    closedTrades: published.length,
    contributors,
    gainsUsd: floor(wins, wholeDollars(wins.reduce((s, r) => s + r.pnl, 0))),
    lossesUsd: floor(losses, wholeDollars(losses.reduce((s, r) => s + r.pnl, 0))),
    winningTrades: floor(wins, wins.length),
    losingTrades: floor(losses, losses.length),
    series,
  };
}
