export const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;

export const EVM_CHART_NETWORKS = {
  ethereum: 'eth',
  base: 'base',
  bsc: 'bsc',
  arbitrum: 'arbitrum',
  polygon: 'polygon_pos',
  avalanche: 'avax',
  optimism: 'optimism',
} as const;

export function geckoNetworkFor(chain: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(EVM_CHART_NETWORKS, chain)) return null;
  return EVM_CHART_NETWORKS[chain as keyof typeof EVM_CHART_NETWORKS];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function number(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function selectEvmMarket(data: unknown, chain: string, address: string, lookup: 'token' | 'pool') {
  if (!Array.isArray(data) || !EVM_ADDRESS.test(address)) return null;
  const requested = address.toLowerCase();
  const markets = data.flatMap((value: unknown) => {
    const row = object(value);
    if (row.chainId !== chain) return [];
    const pool = string(row.pairAddress);
    const baseToken = object(row.baseToken);
    const quoteToken = object(row.quoteToken);
    const mint = string(baseToken.address);
    if (!pool || !mint || !EVM_ADDRESS.test(pool) || !EVM_ADDRESS.test(mint)) return [];
    if ((lookup === 'pool' ? pool : mint).toLowerCase() !== requested) return [];
    const priceUsd = number(row.priceUsd);
    const liquidityUsd = number(object(row.liquidity).usd);
    if (lookup === 'token' && (priceUsd === null || priceUsd <= 0 || liquidityUsd === null || liquidityUsd <= 0)) return [];
    return [{
      pool, mint, symbol: string(baseToken.symbol), quote: string(quoteToken.symbol),
      dexId: string(row.dexId),
      priceUsd: priceUsd !== null && priceUsd > 0 ? priceUsd : null,
      liquidityUsd, change24h: number(object(row.priceChange).h24),
      mcap: number(row.marketCap) ?? number(row.fdv),
      volume24h: number(object(row.volume).h24),
    }];
  });
  return markets.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0)
    || (b.volume24h ?? 0) - (a.volume24h ?? 0))[0] ?? null;
}
