import { describe, expect, it } from 'vitest';
import {
  bestBasePairPerToken,
  filterBasePairsForTokens,
  parseBasePairs,
  parseBaseTokenIdentities,
} from '@/lib/base-market-data';

const A = '0x0000000000000000000000000000000000000001';
const B = '0x0000000000000000000000000000000000000002';
const C = '0x0000000000000000000000000000000000000003';
const D = '0x0000000000000000000000000000000000000004';

function pair(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 'base',
    pairAddress: D,
    baseToken: { address: A, name: 'Token', symbol: 'TOK' },
    quoteToken: { address: B, symbol: 'USDC' },
    priceUsd: '0.25',
    volume: { h24: 100 },
    liquidity: { usd: 500 },
    fdv: 10000,
    priceChange: { h24: 4 },
    pairCreatedAt: 1700000000000,
    url: 'https://dexscreener.com/base/example',
    ...overrides,
  };
}

describe('Base read-only market data hardening', () => {
  it('keeps only valid Base EVM token addresses and deduplicates case-insensitively', () => {
    expect(parseBaseTokenIdentities([
      { chainId: 'base', tokenAddress: A },
      { chainId: 'base', tokenAddress: A.toUpperCase().replace('0X', '0x') },
      { chainId: 'base', tokenAddress: '0xabc' },
      { chainId: 'ethereum', tokenAddress: B },
      { chainId: 'base', tokenAddress: '' },
    ])).toEqual([{ network: 'base', address: A }]);
  });

  it('rejects non-Base, malformed, and duplicate pair addresses', () => {
    const parsed = parseBasePairs([
      pair(),
      pair({ pairAddress: '0xabc' }),
      pair({ chainId: 'ethereum', pairAddress: C }),
      pair({ pairAddress: D.toUpperCase().replace('0X', '0x') }),
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].pairAddress).toBe(D);
  });

  it('normalizes missing and invalid numeric values without manufacturing prices', () => {
    const [parsed] = parseBasePairs([pair({
      priceUsd: null,
      volume: { h24: -10 },
      liquidity: { usd: 'not-a-number' },
      fdv: 0,
      marketCap: '2000',
      priceChange: { h24: 'bad' },
      pairCreatedAt: 'bad',
      url: 'javascript:alert(1)',
    })]);
    expect(parsed).toMatchObject({
      priceUsd: null,
      volume24hUsd: 0,
      liquidityUsd: 0,
      fdvUsd: 2000,
      priceChange24hPct: null,
      pairCreatedAtMs: null,
      url: null,
    });
  });

  it('only accepts requested tokens on the base side of the pair', () => {
    const parsed = parseBasePairs([
      pair({ pairAddress: C, baseToken: { address: B }, quoteToken: { address: A } }),
      pair({ pairAddress: D, baseToken: { address: A }, quoteToken: { address: B } }),
    ]);
    expect(filterBasePairsForTokens(parsed, [A])).toHaveLength(1);
    expect(filterBasePairsForTokens(parsed, [A])[0].baseToken.address).toBe(A);
  });

  it('ranks by liquidity first and volume second, not an arbitrary blended score', () => {
    const parsed = parseBasePairs([
      pair({ pairAddress: C, liquidity: { usd: 100 }, volume: { h24: 100000 } }),
      pair({ pairAddress: D, liquidity: { usd: 200 }, volume: { h24: 1 } }),
    ]);
    expect(bestBasePairPerToken(parsed).get(A)?.pairAddress).toBe(D);
  });

  it('does not select unpriced or zero-liquidity pairs as market candidates', () => {
    const parsed = parseBasePairs([
      pair({ pairAddress: C, priceUsd: null, liquidity: { usd: 9000 } }),
      pair({ pairAddress: D, priceUsd: '0', liquidity: { usd: 10000 } }),
    ]);
    expect(bestBasePairPerToken(parsed).size).toBe(0);
  });

  it('uses volume as a tie-breaker when liquidity is equal', () => {
    const parsed = parseBasePairs([
      pair({ pairAddress: C, liquidity: { usd: 500 }, volume: { h24: 100 } }),
      pair({ pairAddress: D, liquidity: { usd: 500 }, volume: { h24: 200 } }),
    ]);
    expect(bestBasePairPerToken(parsed).get(A)?.pairAddress).toBe(D);
  });
});
