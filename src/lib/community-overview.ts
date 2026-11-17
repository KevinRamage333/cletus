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

export function collectivePnl(closedPnls: Array<number | null>, contributors: number) {
  if (contributors < MIN_CONTRIBUTORS) return { suppressed: true as const, minContributors: MIN_CONTRIBUTORS };
  const vals = closedPnls.filter((v): v is number => v != null && Number.isFinite(v));
  const gains = vals.filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const losses = vals.filter((v) => v < 0).reduce((s, v) => s + v, 0);
  return { suppressed: false as const, netUsd: gains + losses, gainsUsd: gains, lossesUsd: losses, closedTrades: vals.length };
}
