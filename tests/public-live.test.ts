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

import { booksFromMaybeMixed, buildPublicBooks, isLiveBookTrade, LIVE_BOOK_START_ISO, LIVE_EMPTY_MESSAGE } from '@/lib/public-live';

describe('live book isolation from paper / simulation history', () => {
  const paperCloses = [
    { id: 's1', symbol: 'BONK', closedAt: '2026-11-10T16:00:00.000Z', pnlUsd: -40.12, pnlPct: -8, simulated: true, isOperator: true },
    { id: 's2', symbol: 'WIF', closedAt: '2026-11-10T17:00:00.000Z', pnlUsd: 12.40, pnlPct: 5, simulated: true, isOperator: true },
    { id: 's3', symbol: 'POPCAT', closedAt: '2026-11-10T18:00:00.000Z', pnlUsd: -90.00, pnlPct: -15, simulated: true, isOperator: true },
    { id: 's4', symbol: 'MEW', closedAt: '2026-11-10T19:00:00.000Z', pnlUsd: -50.11, pnlPct: -10, simulated: true, isOperator: true },
    { id: 's5', symbol: 'MOODENG', closedAt: '2026-11-10T20:00:00.000Z', pnlUsd: -70.00, pnlPct: -12, simulated: true, isOperator: true },
    { id: 's6', symbol: 'FARTCOIN', closedAt: '2026-11-11T16:00:00.000Z', pnlUsd: -37.00, pnlPct: -6, simulated: true, isOperator: true },
  ];
  const paperPnl = paperCloses.reduce((s, t) => s + t.pnlUsd, 0); // -274.83

  it('treats simulated and pre-cutoff trades as simulation history, not the live book', () => {
    expect(LIVE_BOOK_START_ISO).toBe('2026-11-11T18:23:00.000Z');
    expect(isLiveBookTrade({ at: '2026-11-11T18:23:00.000Z', simulated: false })).toBe(true);
    expect(isLiveBookTrade({ at: '2026-11-11T18:22:59.000Z', simulated: false })).toBe(false);
    expect(isLiveBookTrade({ at: '2026-11-12T00:00:00.000Z', simulated: true })).toBe(false);
    expect(isLiveBookTrade({ closedAt: '2026-11-11T12:23:00.000-06:00', simulated: false })).toBe(true);
  });

  it('defaults /live to an empty live book and parks the −$274.83 paper closes in simulation history', () => {
    const rows = recordedFromClosedPositions(paperCloses);
    const books = buildPublicBooks(rows, new Date('2026-11-11T18:30:00.000Z'));
    expect(books.live.hasData).toBe(false);
    expect(books.live.totalPnlUsd).toBeNull();
    expect(books.live.todayPnlUsd).toBeNull();
    expect(books.live.tradeCount).toBe(0);
    expect(books.live.ticker).toEqual([]);
    expect(books.live.emptyMessage).toBe(LIVE_EMPTY_MESSAGE);
    expect(books.live.book).toBe('live');
    expect(books.live.hasSimulationHistory).toBe(true);
    expect(books.simulation.hasData).toBe(true);
    expect(books.simulation.book).toBe('simulation');
    expect(books.simulation.allSimulated).toBe(true);
    expect(books.simulation.tradeCount).toBe(6);
    expect(books.simulation.totalPnlUsd).toBeCloseTo(-274.83);
    expect(JSON.stringify(books.live)).not.toMatch(/274/);
  });

  it('keeps a post-cutoff live close in the live book and does not mix paper totals into it', () => {
    const rows = mergeRecorded(
      recordedFromClosedPositions(paperCloses),
      recordedFromClosedPositions([{ id: 'l1', symbol: 'SOL', closedAt: '2026-11-11T18:40:00.000Z', pnlUsd: 0.35, pnlPct: 3.5, simulated: false, isOperator: true }]),
    );
    const books = buildPublicBooks(rows, new Date('2026-11-11T18:45:00.000Z'));
    expect(books.live.hasData).toBe(true);
    expect(books.live.tradeCount).toBe(1);
    expect(books.live.totalPnlUsd).toBeCloseTo(0.35);
    expect(books.live.emptyMessage).toBeNull();
    expect(books.simulation.totalPnlUsd).toBeCloseTo(-274.83);
    expect(books.live.totalPnlUsd).not.toBeCloseTo(-274.83);
  });

  it('re-splits a stale mixed snapshot so paper totals cannot leak into the live book', () => {
    const mixed = buildPublicLiveStats(recordedFromClosedPositions(paperCloses), new Date('2026-11-11T18:30:00.000Z'));
    expect(mixed.hasData).toBe(true);
    expect(mixed.totalPnlUsd).toBeCloseTo(-274.83);
    const books = booksFromMaybeMixed(mixed, new Date('2026-11-11T18:30:00.000Z'));
    expect(books.live.hasData).toBe(false);
    expect(books.live.totalPnlUsd).toBeNull();
    expect(books.live.emptyMessage).toBe(LIVE_EMPTY_MESSAGE);
    expect(books.simulation.totalPnlUsd).toBeCloseTo(-274.83);
    expect(books.simulation.tradeCount).toBe(6);
  });
});
