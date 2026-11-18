import { describe, expect, it, vi } from 'vitest';
import { isolateLiveWatch, liveWatchFromAccountStatus, numOrNull, sumKnown, sumTodayPnl } from '@/lib/live-watch';
import { combinedWallets, emptyKolDesk } from '@/lib/owner-kol';

vi.mock('@/lib/live-trades', async (orig) => ({ ...(await orig<typeof import('@/lib/live-trades')>()), readLiveTrades: () => [] }));
import { applyLogAndChain, emptyWatch } from '@/lib/owner-status';
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

describe('missing sell P&L keeps realized unknown (Audit N8 residuals)', () => {
  const sell = (id: string, pnlUsd: number | null, simulated: boolean, at: string) => ({
    id, kind: 'sell' as const, at, symbol: 'ABC', mint: 'm', sizeUsd: 10, entryPrice: 1, exitPrice: 1.1,
    pnlUsd, pnlPct: pnlUsd, reason: 'tp', win: pnlUsd == null ? null : pnlUsd > 0, solscan: null, solscanMint: null, simulated,
  });

  it('liveWatchFromAccountStatus: no account figure and a closed trade without P&L gives null realized and total', () => {
    const w = liveWatchFromAccountStatus({ config: { mode: 'simulation' }, open: [], closed: [{ id: 'c1', pnlUsd: 5 }, { id: 'c2' }] });
    expect(w.realizedPnl).toBeNull();
    expect(w.totalPnl).toBeNull();
    const known = liveWatchFromAccountStatus({ config: { mode: 'simulation' }, open: [], closed: [{ id: 'c1', pnlUsd: 5 }, { id: 'c2', pnlUsd: -2 }] });
    expect(known.realizedPnl).toBe(3);
    expect(known.totalPnl).toBe(3);
  });

  it('isolateLiveWatch: a live or sim sell without P&L makes that book realized/total null, not $0', () => {
    const base = liveWatchFromAccountStatus({ config: { mode: 'live' }, account: { equity: 100, realizedPnl: 4, unrealizedPnl: 0 }, open: [], closed: [] });
    const watch = { ...base, feed: [sell('l1', 2, false, '2026-11-15T12:00:00.000Z'), sell('l2', null, false, '2026-11-15T13:00:00.000Z'), sell('s1', 3, true, '2026-11-01T12:00:00.000Z'), sell('s2', null, true, '2026-11-01T13:00:00.000Z')] };
    const { live, simulation } = isolateLiveWatch(watch, 100);
    expect(live.realizedPnl).toBeNull();
    expect(live.totalPnl).toBeNull();
    expect(live.equityCurve).toEqual([]);
    expect(simulation.realizedPnl).toBeNull();
    expect(simulation.totalPnl).toBeNull();
    const ok = isolateLiveWatch({ ...watch, feed: [sell('l1', 2, false, '2026-11-15T12:00:00.000Z'), sell('s1', 3, true, '2026-11-01T12:00:00.000Z')] }, 100);
    expect(ok.live.realizedPnl).toBe(2);
    expect(ok.simulation.realizedPnl).toBe(3);
  });

  it('owner status: a logged sell without P&L leaves realized and total unknown and draws no $0-anchored curve', () => {
    const base = liveWatchFromAccountStatus({ config: { mode: 'live' }, account: { realizedPnl: 4, unrealizedPnl: 0 }, open: [], closed: [] });
    const watch = { ...base, equityUsd: null, equityCurve: [], feed: [sell('l1', 2, false, '2026-11-15T12:00:00.000Z'), sell('l2', null, false, '2026-11-15T13:00:00.000Z')] };
    const out = applyLogAndChain(watch, null, null);
    expect(out.realizedPnl).toBeNull();
    expect(out.totalPnl).toBeNull();
    expect(out.equityCurve).toEqual([]);
  });

  it('combinedWallets does not substitute $0 or realized-only for an unknown main-wallet total', () => {
    const c = combinedWallets({ sol: 1, equityUsd: 100, realizedPnl: null, totalPnl: null, openAll: [] }, emptyKolDesk());
    expect(c.realizedPnl).toBeNull();
    expect(c.totalPnl).toBeNull();
  });
});

describe('owner-only leftovers stay unknown, never $0 (Audit rereview3 N8 a-c)', () => {
  const now = new Date('2026-11-18T18:00:00.000Z'); // midday America/Chicago

  it("today's P&L is null when a sell closed today has no P&L, and ignores earlier days", () => {
    expect(sumTodayPnl([{ pnlUsd: 2, at: '2026-11-18T16:00:00.000Z' }, { pnlUsd: null, at: '2026-11-18T17:00:00.000Z' }], now)).toBeNull();
    expect(sumTodayPnl([{ pnlUsd: 2, at: '2026-11-18T16:00:00.000Z' }, { pnlUsd: null, at: '2026-11-10T17:00:00.000Z' }], now)).toBe(2);
    expect(sumTodayPnl([], now)).toBe(0);
  });

  it('combined USD and SOL are unknown when the KOL desk exists but its balance is missing', () => {
    const c = combinedWallets({ sol: 1, equityUsd: 100, realizedPnl: 1, totalPnl: 1, openAll: [] }, emptyKolDesk());
    expect(c.usd).toBeNull();
    expect(c.sol).toBeNull();
    const mainOnly = combinedWallets({ sol: 1, equityUsd: 100, realizedPnl: 1, totalPnl: 1, openAll: [] }, null);
    expect(mainOnly.usd).toBe(100);
    expect(mainOnly.sol).toBe(1);
  });

  it('the empty owner watch (no snapshot, no log) reports P&L as unknown', () => {
    const w = emptyWatch('live', null);
    expect(w.realizedPnl).toBeNull();
    expect(w.unrealizedPnl).toBeNull();
    expect(w.totalPnl).toBeNull();
    expect(w.todayPnl).toBeNull();
  });
});
