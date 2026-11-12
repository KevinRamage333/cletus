import { describe, it, expect } from 'vitest';
import { popularMintsFromPairs, popularWindowScore, POPULAR_WINDOWS, type DexPair } from '@/lib/dexscreener';

const pair = (sym: string, vol: Partial<DexPair['volume']>, tx?: Partial<NonNullable<DexPair['txns']>>): DexPair => ({
  chainId: 'solana', dexId: 'raydium', pairAddress: sym, baseToken: { address: `mint_${sym}`, name: sym, symbol: sym },
  quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' },
  volume: vol, txns: { m5: { buys: 0, sells: 0 }, h1: { buys: 0, sells: 0 }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 }, ...tx },
});

describe('dexscreener popular windows', () => {
  it('scores volume plus txn count and takes top-N per m5/h1/h6/h24, deduped', () => {
    expect(POPULAR_WINDOWS).toEqual(['m5', 'h1', 'h6', 'h24']);
    const a = pair('A', { m5: 1000, h1: 10, h6: 10, h24: 10 }, { m5: { buys: 50, sells: 50 } });
    const b = pair('B', { m5: 10, h1: 5000, h6: 10, h24: 10 });
    const c = pair('C', { m5: 10, h1: 10, h6: 8000, h24: 10 });
    const d = pair('D', { m5: 10, h1: 10, h6: 10, h24: 9000 });
    const e = pair('E', { m5: 900, h1: 10, h6: 10, h24: 10 }); // second in m5
    const eth = { ...pair('ETH', { m5: 99_999 }), chainId: 'ethereum' } as DexPair;
    const mints = popularMintsFromPairs([a, b, c, d, e, eth], 1);
    expect(mints).toEqual(['mint_A', 'mint_B', 'mint_C', 'mint_D']);
    expect(popularWindowScore(a, 'm5')).toBeGreaterThan(popularWindowScore(e, 'm5'));
    // per-window=2 includes E in the m5 set; already-seen A occupies a slot
    expect(popularMintsFromPairs([a, b, c, d, e], 2)).toEqual(['mint_A', 'mint_E', 'mint_B', 'mint_C', 'mint_D']);
  });
});
