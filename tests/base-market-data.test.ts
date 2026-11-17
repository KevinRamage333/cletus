import { describe, expect, it } from 'vitest';
import {
  bestBasePairPerToken,
  filterBasePairsForTokens,
  isBaseAddress,
  parseBasePairs,
  parseBaseTokenIdentities,
} from '@/lib/base-market-data';

const A = '0x00000000000000000000000000000000000000a1';
const B = '0x00000000000000000000000000000000000000b2';
const C = '0x00000000000000000000000000000000000000c3';
const D = '0x00000000000000000000000000000000000000d4';

function pair(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 'base', pairAddress: D,
    baseToken: { address: A, name: 'Token', symbol: 'TOK' },
    quoteToken: { address: B, symbol: 'USDC' },
    priceUsd: '0.25', volume: { h24: 100 }, liquidity: { usd: 500 },
    fdv: 10000, priceChange: { h24: 4 }, pairCreatedAt: 1700000000000,
    url: 'https://dexscreener.com/base/example', ...overrides,
  };
}

describe('Base market-data adapter v2', () => {
  it('validates EVM addresses strictly', () => {
    expect(isBaseAddress(A)).toBe(true);
    expect(isBaseAddress('0xabc')).toBe(false);
    expect(isBaseAddress('0x' + 'g'.repeat(40))).toBe(false);
    expect(isBaseAddress(null)).toBe(false);
  });

  it('keeps only Base token identities and deduplicates case-insensitively', () => {
    expect(parseBaseTokenIdentities([
      { chainId: 'base', tokenAddress: A },
      { chainId: 'base', tokenAddress: A.toUpperCase().replace('0X', '0x') },
      { chainId: 'ethereum', tokenAddress: B },
      { chainId: 'base', tokenAddress: '0xabc' },
    ])).toEqual([{ network: 'base', address: A }]);
  });

  it('rejects wrong-chain, malformed and duplicate pairs', () => {
    const parsed = parseBasePairs([
      pair(),
      pair({ chainId: 'ethereum', pairAddress: C }),
      pair({ pairAddress: '0xabc' }),
      pair({ pairAddress: D.toUpperCase().replace('0X', '0x') }),
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].pairAddress).toBe(D);
  });

  it('does not manufacture a zero price from missing or malformed values', () => {
    const parsed = parseBasePairs([
      pair({ priceUsd: null }),
      pair({ pairAddress: C, priceUsd: '' }),
      pair({ pairAddress: '0x00000000000000000000000000000000000000e5', priceUsd: 'not-a-number' }),
    ]);
    expect(parsed.map(row => row.priceUsd)).toEqual([null, null, null]);
  });

  it('normalizes invalid numeric fields safely and accepts valid market-cap fallback', () => {
    const [parsed] = parseBasePairs([pair({
      volume: { h24: -10 }, liquidity: { usd: 'not-a-number' },
      fdv: 0, marketCap: '2000', priceChange: { h24: 'bad' },
      pairCreatedAt: 'bad', url: 'javascript:alert(1)',
    })]);
    expect(parsed).toMatchObject({
      volume24hUsd: 0, liquidityUsd: 0, fdvUsd: 2000,
      priceChange24hPct: null, pairCreatedAtMs: null, url: null,
    });
  });

  it('accepts only secure DexScreener pair URLs', () => {
    expect(parseBasePairs([pair({ url: 'https://evil.example/path' })])[0].url).toBeNull();
    expect(parseBasePairs([pair({ url: 'http://dexscreener.com/base/pair' })])[0].url).toBeNull();
    expect(parseBasePairs([pair()])[0].url).toBe('https://dexscreener.com/base/example');
  });

  it('filters quote-side matches and malformed requested addresses', () => {
    const parsed = parseBasePairs([
      pair({ pairAddress: C, baseToken: { address: B }, quoteToken: { address: A } }),
      pair({ pairAddress: D, baseToken: { address: A }, quoteToken: { address: B } }),
    ]);
    expect(filterBasePairsForTokens(parsed, [A, '0xabc']).map(row => row.pairAddress)).toEqual([D]);
  });

  it('ranks by liquidity first and volume second', () => {
    const parsed = parseBasePairs([
      pair({ pairAddress: C, liquidity: { usd: 100 }, volume: { h24: 100000 } }),
      pair({ pairAddress: D, liquidity: { usd: 200 }, volume: { h24: 1 } }),
    ]);
    expect(bestBasePairPerToken(parsed).get(A)?.pairAddress).toBe(D);
  });

  it('uses volume only to break equal-liquidity ties', () => {
    const parsed = parseBasePairs([
      pair({ pairAddress: C, liquidity: { usd: 500 }, volume: { h24: 100 } }),
      pair({ pairAddress: D, liquidity: { usd: 500 }, volume: { h24: 200 } }),
    ]);
    expect(bestBasePairPerToken(parsed).get(A)?.pairAddress).toBe(D);
  });

  it('excludes unpriced and zero-liquidity markets from candidate selection', () => {
    const parsed = parseBasePairs([
      pair({ pairAddress: C, priceUsd: null, liquidity: { usd: 9000 } }),
      pair({ pairAddress: D, priceUsd: '0', liquidity: { usd: 10000 } }),
      pair({ pairAddress: '0x00000000000000000000000000000000000000e5', liquidity: { usd: 0 } }),
    ]);
    expect(bestBasePairPerToken(parsed).size).toBe(0);
  });
});
