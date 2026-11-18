import { describe, expect, it } from 'vitest';
import { bestPairs, formatAge, formatPct, formatUsdCompact, freshness, sortMovers, toMoverCard, type PairWithInfo } from '@/lib/movers';
import { auditVerdict, evaluatePublicAudit, holderFacts } from '@/lib/public-audit';

const pair = (o: Partial<PairWithInfo> & { mint: string }): PairWithInfo => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P' + o.mint, baseToken: { address: o.mint, name: 'N' + o.mint, symbol: 'S' + o.mint }, quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' }, ...o });

describe('movers board', () => {
  it('keeps missing values null instead of zero', () => {
    const c = toMoverCard(pair({ mint: 'A' }));
    expect(c.marketCapUsd).toBeNull(); expect(c.volume24hUsd).toBeNull(); expect(c.change5mPct).toBeNull(); expect(c.priceUsd).toBeNull();
    expect(formatUsdCompact(c.marketCapUsd)).toBe('—'); expect(formatPct(null)).toBe('—'); expect(formatAge(null)).toBe('—');
  });
  it('parses DexScreener string prices and uses the image', () => {
    const c = toMoverCard(pair({ mint: 'B', priceUsd: '0.0012', marketCap: 120000, info: { imageUrl: 'https://x/i.png' }, priceChange: { m5: 12.5, h1: -3 } }));
    expect(c.priceUsd).toBe(0.0012); expect(c.marketCapUsd).toBe(120000); expect(c.imageUrl).toBe('https://x/i.png'); expect(c.change5mPct).toBe(12.5);
  });
  it('sorts with unknowns last', () => {
    const cards = [toMoverCard(pair({ mint: 'A' })), toMoverCard(pair({ mint: 'B', marketCap: 5 })), toMoverCard(pair({ mint: 'C', marketCap: 50 }))];
    expect(sortMovers(cards, 'mcap').map((c) => c.mint)).toEqual(['C', 'B', 'A']);
    const moving = [toMoverCard(pair({ mint: 'A', priceChange: { m5: 1 } })), toMoverCard(pair({ mint: 'B', priceChange: { m5: -30 } })), toMoverCard(pair({ mint: 'C' }))];
    expect(sortMovers(moving, 'movers').map((c) => c.mint)).toEqual(['B', 'A', 'C']);
  });
  it('picks the deepest pool where the mint is base', () => {
    const m = bestPairs([pair({ mint: 'A', liquidity: { usd: 10 } }), pair({ mint: 'A', pairAddress: 'deep', liquidity: { usd: 1000 } }), { ...pair({ mint: 'A' }), chainId: 'base' }]);
    expect(m.get('A')!.pairAddress).toBe('deep');
  });
  it('formats and reports freshness', () => {
    expect(formatUsdCompact(1_250_000)).toBe('$1.25M'); expect(formatUsdCompact(0)).toBe('$0.00');
    expect(formatAge(0, 90_000)).toBe('1m');
    expect(freshness(new Date(1_000).toISOString(), 1_000 + 10_000)).toBe('fresh');
    expect(freshness(new Date(1_000).toISOString(), 1_000 + 200_000)).toBe('stale');
    expect(freshness(null)).toBe('unknown');
  });
});

describe('public audit', () => {
  it('flags active authorities and never passes unverified checks', () => {
    const checks = evaluatePublicAudit({ mintAuthority: 'X', freezeAuthority: null, supplyRaw: '1', decimals: 0, program: 'spl-token' }, null, null);
    expect(checks.find((c) => c.id === 'mint')!.state).toBe('fail');
    expect(checks.find((c) => c.id === 'freeze')!.state).toBe('pass');
    expect(checks.find((c) => c.id === 'holders')!.state).toBe('unknown');
    expect(auditVerdict(checks).state).toBe('fail');
    expect(auditVerdict(evaluatePublicAudit(null, null, 100_000)).state).toBe('unknown');
  });
  it('computes holder concentration', () => {
    const h = holderFacts([{ address: 'a', uiAmount: 30 }, { address: 'b', uiAmount: 10 }], 100)!;
    expect(h.top1Pct).toBe(30); expect(h.top10Pct).toBe(40);
    expect(evaluatePublicAudit({ mintAuthority: null, freezeAuthority: null, supplyRaw: '100', decimals: 0, program: 'spl-token' }, h, 80_000).find((c) => c.id === 'holders')!.state).toBe('fail');
    expect(holderFacts([], 100)).toBeNull();
  });
});
