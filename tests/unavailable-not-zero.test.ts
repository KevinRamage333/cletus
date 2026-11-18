import { describe, expect, it } from 'vitest';
import { liveWatchFromAccountStatus, numOrNull, sumKnown } from '@/lib/live-watch';
import { buildSnapshot } from '@/lib/paper-snapshot';

describe('missing figures stay unavailable, never $0 (Audit N5/N8)', () => {
  it('numOrNull and sumKnown keep unknowns unknown', () => {
    expect(numOrNull(undefined)).toBeNull();
    expect(numOrNull('')).toBeNull();
    expect(numOrNull('abc')).toBeNull();
    expect(numOrNull(0)).toBe(0);
    expect(sumKnown([1, 2])).toBe(3);
    expect(sumKnown([1, null])).toBeNull();
    expect(sumKnown([])).toBe(0);
  });

  it('a status payload missing position fields reports null, not 0', () => {
    const w = liveWatchFromAccountStatus({ config: { mode: 'simulation' }, open: [{ id: 'p1', symbol: 'ABC', mint: 'm' }], closed: [] });
    const p = w.openAll[0];
    expect(p.sizeUsd).toBeNull();
    expect(p.entryPrice).toBeNull();
    expect(p.pnlUsd).toBeNull();
    expect(p.stopLoss).toBeNull();
    expect(w.unrealizedPnl).toBeNull();
    expect(w.totalPnl).toBeNull();
    expect(w.equityCurve).toEqual([]);
  });

  it('known position figures still add up', () => {
    const w = liveWatchFromAccountStatus({
      config: { mode: 'simulation' },
      account: { startingBalance: 100 },
      open: [{ id: 'p1', symbol: 'ABC', mint: 'm', sizeUsd: 10, entryPrice: 1, lastPrice: 1.2, pnlUsd: 2, pnlPct: 20 }],
      closed: [],
    });
    expect(w.unrealizedPnl).toBe(2);
    expect(w.openAll[0].stopLoss).not.toBeNull();
  });

  it('paper snapshot book and network counts are null when the summary lacks them', () => {
    const s = buildSnapshot({ published_at: new Date().toISOString(), summary: { simulated: true, books: [{ book: 'a', label: 'A' }], networks: { solana: {} } } }, []);
    expect(s.books[0].open).toBeNull();
    expect(s.books[0].closed).toBeNull();
    expect(s.networks[0].open).toBeNull();
    expect(s.networks[0].closed).toBeNull();
  });
});
