import { describe, expect, it } from 'vitest';
import { moneyText, parseFigure, refreshedLabel, screenState } from '@/lib/figure';

describe('money figures', () => {
  it('keeps a real zero distinct from missing data', () => {
    expect(parseFigure(0)).toBe(0);
    expect(parseFigure(null)).toBeNull();
    expect(parseFigure(undefined)).toBeNull();
    expect(parseFigure('')).toBeNull();
    expect(parseFigure('nope')).toBeNull();
    expect(moneyText(0)).toEqual({ text: '$0.00', state: 'zero' });
    expect(moneyText(null).state).toBe('unavailable');
    expect(moneyText(null).text).not.toContain('$0');
    expect(moneyText(12.5, true).text).toBe('+$12.50');
  });

  it('names loading, empty, stale, and error without turning a failure into ready zeros', () => {
    expect(screenState({ loading: true, error: null, hasData: false, empty: true })).toBe('loading');
    expect(screenState({ loading: false, error: 'down', hasData: false, empty: true })).toBe('error');
    expect(screenState({ loading: false, error: 'down', hasData: true, empty: false })).toBe('stale');
    expect(screenState({ loading: false, error: null, hasData: true, empty: true, refreshedAt: '2026-11-17T00:00:00Z', now: Date.parse('2026-11-17T00:00:10Z') })).toBe('empty');
    expect(screenState({ loading: false, error: null, hasData: true, empty: false, refreshedAt: '2026-11-17T00:00:00Z', now: Date.parse('2026-11-17T00:02:00Z'), staleMs: 45_000 })).toBe('stale');
    expect(refreshedLabel('Portfolio P&L', null)).toBe('Portfolio P&L has not refreshed');
  });
});
