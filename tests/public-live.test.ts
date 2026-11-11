import { describe, it, expect } from 'vitest';
import {
  ANON_TRADER_LABEL, buildPublicLiveStats, EMPTY_PUBLIC_LIVE, HOUSE_TRADER_LABEL, mergeRecorded,
  PUBLIC_LIVE_DISCLAIMER, recordedFromClosedPositions, recordedFromLiveEvents, traderLabel,
} from '@/lib/public-live';
import { parseLiveTrades } from '@/lib/live-trades';

describe('public live feed: recorded trades only, anonymized', () => {
  it('returns an empty payload when there are no recorded trades — never fabricates numbers', () => {
    const s = buildPublicLiveStats([]);
    expect(s.hasData).toBe(false);
    expect(s.source).toBe('none');
    expect(s.tradeCount).toBe(0);
    expect(s.totalPnlUsd).toBeNull();
    expect(s.todayPnlUsd).toBeNull();
    expect(s.winRate).toBeNull();
    expect(s.ticker).toEqual([]);
    expect(s.disclaimer).toBe(PUBLIC_LIVE_DISCLAIMER);
    expect(s).toMatchObject({ hasData: EMPTY_PUBLIC_LIVE.hasData, totalPnlUsd: null });
  });

  it('aggregates only real recorded sells, labels house trades, and hides wallets by default', () => {
    const rows = recordedFromClosedPositions([
      { id: 'h1', symbol: 'BONK', closedAt: '2026-11-11T12:00:00.000-06:00', pnlUsd: 0.6, pnlPct: 12, exitTx: '5VERv8NMvzbJMEkV8xnrLkEaWJHPGocrHyYxzHjsvAqf', simulated: false, isOperator: true, wallet: 'GdDBJt1nCibTENMKnGRPoNkjaCskTXwrdF1x1UHgY7Hq' },
      { id: 'u1', symbol: 'WIF', closedAt: '2026-11-11T13:00:00.000-06:00', pnlUsd: -0.2, pnlPct: -4, exitTx: '4uQeVj5tqViQh7yWWGSt3ALLb7oFoBTU3FrrJeFHf3pS', simulated: false, isOperator: false, wallet: 'SomeWallet11111111111111111111111111111111' },
      { id: 'openish', symbol: 'MEW', closedAt: null, pnlUsd: 1, pnlPct: 10, simulated: false, isOperator: false },
    ]);
    const s = buildPublicLiveStats(rows, new Date('2026-11-11T18:00:00.000-06:00'));
    expect(s.hasData).toBe(true);
    expect(s.tradeCount).toBe(2);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBe(0.5);
    expect(s.totalPnlUsd).toBeCloseTo(0.4);
    expect(s.todayPnlUsd).toBeCloseTo(0.4);
    expect(s.allSimulated).toBe(false);
    expect(s.anySimulated).toBe(false);
    expect(s.ticker[0].trader).toBe(ANON_TRADER_LABEL);
    expect(s.ticker[1].trader).toBe(HOUSE_TRADER_LABEL);
    expect(JSON.stringify(s.ticker)).not.toMatch(/GdDB|SomeWallet|GJwt/);
    expect(s.ticker[0].solscan).toContain('solscan.io/tx/');
    expect(s.disclaimer).toMatch(/Not financial advice/i);
    expect(s.disclaimer).toMatch(/do not predict future results/i);
  });

  it('flags a fully simulated book and a mixed book, and never shows a wallet without opt-in', () => {
    const sim = buildPublicLiveStats(recordedFromClosedPositions([
      { id: 's1', symbol: 'POPCAT', closedAt: '2026-11-11T18:00:00.000Z', pnlUsd: 1, pnlPct: 8, simulated: true, isOperator: false },
    ]));
    expect(sim.allSimulated).toBe(true);
    expect(sim.anySimulated).toBe(true);
    expect(traderLabel({ isHouse: false, showWallet: false, wallet: 'GdDBJt1nCibTENMKnGRPoNkjaCskTXwrdF1x1UHgY7Hq' })).toBe(ANON_TRADER_LABEL);
    expect(traderLabel({ isHouse: true })).toBe(HOUSE_TRADER_LABEL);
    expect(traderLabel({ isHouse: false, optedInLabel: 'GooseFan' })).toBe('GooseFan');
    const mixed = buildPublicLiveStats(mergeRecorded(
      recordedFromClosedPositions([{ id: 'a', symbol: 'A', closedAt: '2026-11-11T18:00:00.000Z', pnlUsd: 1, pnlPct: 5, simulated: true, isOperator: true }]),
      recordedFromClosedPositions([{ id: 'b', symbol: 'B', closedAt: '2026-11-11T18:01:00.000Z', pnlUsd: 1, pnlPct: 5, simulated: false, isOperator: false }]),
    ));
    expect(mixed.allSimulated).toBe(false);
    expect(mixed.anySimulated).toBe(true);
  });

  it('can fold the box live-trades log into the public book without inventing extras', () => {
    const ev = parseLiveTrades('{"type":"sell","symbol":"WIF","pnlUsd":1.2,"pnlPct":20,"at":"2026-11-11T18:00:00.000Z","signature":"abc","simulated":false}\n{"type":"buy","symbol":"WIF","at":"2026-11-11T17:00:00.000Z"}');
    const s = buildPublicLiveStats(recordedFromLiveEvents(ev, true));
    expect(s.tradeCount).toBe(1);
    expect(s.ticker).toHaveLength(1);
    expect(s.ticker[0].trader).toBe(HOUSE_TRADER_LABEL);
    expect(s.ticker[0].token).toBe('WIF');
  });
});
