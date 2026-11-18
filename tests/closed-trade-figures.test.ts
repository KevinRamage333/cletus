import { describe, expect, it } from 'vitest';
import { closedTradeFigures, pnlPercentOfStart } from '@/lib/closed-trade-figures';

const at = new Date('2026-11-17T12:00:00Z');
const row = (symbol: string, pnlUsd: number | null) => ({ symbol, sizeUsd: 10, pnlUsd, pnlPct: pnlUsd === null ? null : pnlUsd * 10, closedAt: at, openedAt: at });

describe('closed trade figures', () => {
  it('leaves a trade with no recorded P&L out of best/worst and the win rate', () => {
    const f = closedTradeFigures([row('UP', 2), row('DOWN', -1), row('UNKNOWN', null)], 100);
    expect(f.scoredCount).toBe(2);
    expect(f.bestTrade).toBe(2);
    expect(f.worstTrade).toBe(-1);
    expect(f.bestSymbol).toBe('UP');
    expect(f.worstSymbol).toBe('DOWN');
    expect(f.sc.winRate).toBe(0.5);
  });

  it('never turns an unknown P&L into a $0 best or worst trade', () => {
    const f = closedTradeFigures([row('A', -3), row('B', null)], 100);
    expect(f.bestTrade).toBe(-3);
    expect(f.worstTrade).toBe(-3);
    const none = closedTradeFigures([row('B', null)], 100);
    expect(none.bestTrade).toBeNull();
    expect(none.worstTrade).toBeNull();
    expect(none.sc.winRate).toBeNull();
  });

  it('returns null for the 24h percent without a starting balance', () => {
    expect(pnlPercentOfStart(5, 0)).toBeNull();
    expect(pnlPercentOfStart(5, 100)).toBe(5);
    expect(pnlPercentOfStart(0, 100)).toBe(0);
  });
});
