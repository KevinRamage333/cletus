import { describe, it, expect } from 'vitest';
import { phantomMintsFromItems, phantomTrendingUrl, parsePhantomTimeframes, PHANTOM_TIMEFRAMES } from '@/lib/phantom';

describe('phantom trending source', () => {
  it('builds the public explore URL for Solana', () => {
    const u = phantomTrendingUrl('1h', 99);
    expect(u).toContain('api.phantom.app/explore/v2/trending-tokens');
    expect(u).toContain('timeFrame=1h');
    expect(u).toContain('limit=50');
    expect(u).toContain('chainIds=solana%3A101');
  });
  it('keeps Solana mints, drops stables/SOL/spam/out-of-band, dedupes', () => {
    const items = [
      { chainId: 'solana:101', address: 'A', marketCap: 100_000 },
      { chainId: 'solana:101', address: 'A', marketCap: 100_000 },
      { chainId: 'eip155:8453', address: 'B', marketCap: 100_000 },
      { chainId: 'solana:101', address: 'So11111111111111111111111111111111111111112', marketCap: 1e11 },
      { chainId: 'solana:101', address: 'C', marketCap: 50_000_000 },
      { chainId: 'solana:101', address: 'D', marketCap: 5_000 },
      { chainId: 'solana:101', address: 'E', marketCap: null },
      { chainId: 'solana:101', address: 'F', marketCap: 200_000, spamStatus: 'SPAM' },
      { chainId: 'solana:101', address: 'G', marketCap: 9_000_000 },
    ];
    expect(phantomMintsFromItems(items, { min: 25_000, max: 5_000_000 })).toEqual(['A', 'E', 'G']);
    expect(phantomMintsFromItems(items)).toEqual(['A', 'C', 'D', 'E', 'G']);
  });
  it('parses timeframes, falling back to all', () => {
    expect(parsePhantomTimeframes(undefined)).toEqual([...PHANTOM_TIMEFRAMES]);
    expect(parsePhantomTimeframes('24h, 1h,5m')).toEqual(['1h', '24h']);
    expect(parsePhantomTimeframes('5m')).toEqual([...PHANTOM_TIMEFRAMES]);
  });
});
