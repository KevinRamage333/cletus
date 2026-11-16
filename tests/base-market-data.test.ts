import { describe, expect, it } from 'vitest';
import { bestBasePairPerToken, parseBasePairs, parseBaseTokenIdentities } from '@/lib/base-market-data';

describe('Base read-only market data', () => {
  it('keeps only Base token identities and de-duplicates case-insensitively', () => {
    expect(parseBaseTokenIdentities([
      { chainId: 'base', tokenAddress: '0xAbC' },
      { chainId: 'base', tokenAddress: '0xabc' },
      { chainId: 'solana', tokenAddress: 'So111' },
      { chainId: 'base', tokenAddress: '' },
    ])).toEqual([{ network: 'base', address: '0xAbC' }]);
  });

  it('rejects non-Base and malformed pairs and normalizes numeric fields safely', () => {
    const pairs = parseBasePairs([
      { chainId: 'base', pairAddress: '0xPair', baseToken: { address: '0xToken', symbol: 'TOK' }, quoteToken: { address: '0xUsdc', symbol: 'USDC' }, priceUsd: '0.25', volume: { h24: 100 }, liquidity: { usd: 500 }, priceChange: { h24: 4 } },
      { chainId: 'solana', pairAddress: 'pair2', baseToken: { address: 'mint' }, quoteToken: { address: 'quote' } },
      { chainId: 'base', pairAddress: '', baseToken: { address: '0xToken' }, quoteToken: { address: '0xUsdc' } },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ chainId: 'base', priceUsd: 0.25, volume24hUsd: 100, liquidityUsd: 500, priceChange24hPct: 4 });
  });

  it('chooses the deepest/most active pair for each token', () => {
    const pairs = parseBasePairs([
      { chainId: 'base', pairAddress: 'p1', baseToken: { address: '0xToken' }, quoteToken: { address: '0xQ' }, liquidity: { usd: 100 }, volume: { h24: 10 } },
      { chainId: 'base', pairAddress: 'p2', baseToken: { address: '0xtoken' }, quoteToken: { address: '0xQ' }, liquidity: { usd: 200 }, volume: { h24: 10 } },
    ]);
    expect(bestBasePairPerToken(pairs).get('0xtoken')?.pairAddress).toBe('p2');
  });
});
