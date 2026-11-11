import { describe, it, expect } from 'vitest';
import { watchList, duePools, candleUpsertSql } from '@/lib/market-data';

const pos = [{ pairAddress: 'P1', mint: 'M1', symbol: 'AAA' }, { pairAddress: null, mint: 'M9', symbol: 'NOPAIR' }];
const cands = [
  { pairAddress: 'P2', mint: 'M2', symbol: 'BBB', composite: 0.6 },
  { pairAddress: 'P1', mint: 'M1', symbol: 'AAA', composite: 0.9 },
  { pairAddress: 'P3', mint: 'M3', symbol: 'CCC', composite: 0.8, rejected: 'liquidity' },
  { pairAddress: 'P4', mint: 'M4', symbol: 'DDD', composite: 0.7 },
];

describe('market_data collector', () => {
  it('watch list: positions first, de-duped, rejected skipped, capped', () => {
    const w = watchList(pos, cands, 3);
    expect(w.map((x) => x.pool)).toEqual(['P1', 'P4', 'P2']);
    expect(w[0].reason).toBe('position');
    expect(watchList(pos, cands, 2).map((x) => x.pool)).toEqual(['P1', 'P4']);
  });
  it('due pools respects per-tick budget, interval, and position priority', () => {
    const w = watchList(pos, cands, 10);
    const now = 1_800_000_000_000;
    const last = new Map([['P4', now - 60_000]]);           // polled 1 min ago → not due
    expect(duePools(w, last, now, 2, 300_000).map((x) => x.pool)).toEqual(['P1', 'P2']);
    expect(duePools(w, new Map([['P1', now - 1], ['P2', now - 1], ['P4', now - 1]]), now, 2, 300_000)).toEqual([]);
    expect(duePools(w, new Map(), now, 1, 300_000).map((x) => x.pool)).toEqual(['P1']);
  });
  it('builds a parameterised multi-row upsert', () => {
    const q = candleUpsertSql('P1', [{ time: 60, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }, { time: 120, open: 1.5, high: 1.6, low: 1.4, close: 1.45, volume: 0 }]);
    expect(q.values).toHaveLength(16);
    expect(q.text).toContain('on conflict (pool, bucket) do update');
    expect(q.text).toContain('to_timestamp($10)');
    expect(q.text).not.toContain('P1');
  });
});
