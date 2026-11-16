import { describe, it, expect } from 'vitest';
import { assessMarketRegime, marketRegimeBlocksEntries } from '../src/lib/market-regime';

describe('market regime intelligence', () => {
  it('does not pretend a tiny sample is a market trend', () => {
    const r = assessMarketRegime([{ h1: 8 }, { h1: 9 }, { h1: 7 }], 123);
    expect(r.regime).toBe('unknown'); expect(r.confidence).toBe('low');
    expect(marketRegimeBlocksEntries(r.regime)).toBe(false); expect(r.assessedAt).toBe(123);
  });
  it('recognizes broad risk-off conditions using median and breadth', () => {
    const r = assessMarketRegime(Array.from({ length: 20 }, (_, i) => ({ h1: i === 0 ? 30 : -4, h24: -10 })));
    expect(r.regime).toBe('risk_off'); expect(r.breadthUp).toBe(0.05);
    expect(marketRegimeBlocksEntries(r.regime)).toBe(true);
  });
  it('recognizes broad risk-on conditions only when breadth agrees', () => {
    const r = assessMarketRegime(Array.from({ length: 20 }, () => ({ h1: 3, h24: 12 })));
    expect(r.regime).toBe('risk_on'); expect(marketRegimeBlocksEntries(r.regime)).toBe(false);
  });
  it('flags extreme volatility even when the median direction is flat', () => {
    const r = assessMarketRegime(Array.from({ length: 12 }, (_, i) => ({ h1: i % 2 ? 20 : -20 })));
    expect(r.regime).toBe('high_volatility'); expect(marketRegimeBlocksEntries(r.regime)).toBe(true);
  });
  it('uses the median so one extreme token cannot create a false risk-on regime', () => {
    const r = assessMarketRegime([{ h1: 1000 }, ...Array.from({ length: 19 }, () => ({ h1: -1 }))]);
    expect(r.regime).toBe('neutral');
  });
});
