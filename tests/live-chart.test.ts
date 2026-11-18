import { describe, expect, it } from 'vitest';
import { CHART_RANGES, CHART_REFRESH_MS, SYMBOL_QUERY, cumulativePnlSeries, mostTradedToken, normRange, toneOf } from '@/lib/live-chart';

describe('live chart helpers', () => {
  it('normalizes ranges and has a refresh for each', () => {
    expect(normRange('4h')).toBe('4H');
    expect(normRange('bogus')).toBe('1H');
    expect(normRange(null)).toBe('1H');
    for (const r of CHART_RANGES) expect(CHART_REFRESH_MS[r]).toBeGreaterThan(0);
  });
  it('guards symbol queries', () => {
    expect(SYMBOL_QUERY.test('BONK')).toBe(true);
    expect(SYMBOL_QUERY.test('$WIF')).toBe(true);
    expect(SYMBOL_QUERY.test('a b')).toBe(false);
    expect(SYMBOL_QUERY.test('<script>')).toBe(false);
    expect(SYMBOL_QUERY.test('')).toBe(false);
  });
  it('builds a cumulative daily P&L series from real closes only', () => {
    const s = cumulativePnlSeries([
      { closedAt: '2026-11-15T10:00:00Z', pnlUsd: 10 },
      { closedAt: '2026-11-15T22:00:00Z', pnlUsd: -4 },
      { closedAt: '2026-11-16T01:00:00Z', pnlUsd: 2.5 },
      { closedAt: null, pnlUsd: 99 },
      { closedAt: '2026-11-16T02:00:00Z', pnlUsd: null },
      { closedAt: 'not a date', pnlUsd: 5 },
    ]);
    expect(s).toEqual([{ time: Date.UTC(2026, 10, 15) / 1000, value: 6 }, { time: Date.UTC(2026, 10, 16) / 1000, value: 8.5 }]);
    expect(cumulativePnlSeries([])).toEqual([]);
  });
  it('finds the most-traded Solana token', () => {
    const rows = [{ mint: 'A', symbol: 'AAA' }, { mint: 'B', symbol: 'BBB' }, { mint: 'B', symbol: 'BBB' }, { mint: 'C', symbol: 'CCC', network: 'base' }, { mint: 'C', symbol: 'CCC', network: 'base' }, { mint: 'C', symbol: 'CCC', network: 'base' }];
    expect(mostTradedToken(rows)).toEqual({ mint: 'B', symbol: 'BBB', trades: 2 });
    expect(mostTradedToken(rows, 'base')).toEqual({ mint: 'C', symbol: 'CCC', trades: 3 });
    expect(mostTradedToken([])).toBeNull();
  });
  it('tones gains green / losses red', () => {
    expect(toneOf(1)).toBe('up'); expect(toneOf(-1)).toBe('down'); expect(toneOf(0)).toBe('flat'); expect(toneOf(null)).toBe('flat');
  });
});
