import { describe, expect, it } from 'vitest';
import { lotsToCsv, newPaperAccount, paperBuy, paperSell, parseAccount, realizedLots, valueAccount, PAPER_FEE_RATE } from '@/lib/local-paper';

const q = (price: number | null, liq: number | null = 1_000_000) => ({ mint: 'MintA', symbol: 'AAA', priceUsd: price, liquidityUsd: liq });
const t0 = new Date('2026-11-17T12:00:00Z');

describe('local paper trading', () => {
  it('buys with fee and price impact and debits cash', () => {
    const r = paperBuy(newPaperAccount(10_000, t0), q(1), 1_000, t0);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.account.cashUsd).toBe(9_000);
    expect(r.trade.feeUsd).toBeCloseTo(1_000 * PAPER_FEE_RATE);
    expect(r.trade.fillPriceUsd).toBeGreaterThan(1);
    expect(r.account.positions[0].tokens).toBeLessThan(995);
  });
  it('refuses unknown prices, zero, and overdrafts', () => {
    const a = newPaperAccount(100, t0);
    expect(paperBuy(a, q(null), 10).ok).toBe(false);
    expect(paperBuy(a, q(1), 0).ok).toBe(false);
    expect(paperBuy(a, q(1), 101).ok).toBe(false);
  });
  it('round trip at an unchanged price loses fees and impact', () => {
    const b = paperBuy(newPaperAccount(10_000, t0), q(2), 1_000, t0); if (!b.ok) throw new Error();
    const s = paperSell(b.account, q(2), 1, new Date(t0.getTime() + 60_000)); if (!s.ok) throw new Error();
    expect(s.account.positions).toHaveLength(0);
    expect(s.trade.realizedPnlUsd!).toBeLessThan(0);
    expect(s.trade.realizedPnlUsd!).toBeGreaterThan(-15);
    expect(s.account.cashUsd).toBeCloseTo(10_000 + s.trade.realizedPnlUsd!, 6);
  });
  it('partial sell keeps average cost and realizes a gain when price rises', () => {
    const b = paperBuy(newPaperAccount(10_000, t0), q(1, null), 1_000, t0); if (!b.ok) throw new Error();
    const s = paperSell(b.account, q(2, null), 0.5, t0); if (!s.ok) throw new Error();
    expect(s.account.positions[0].costUsd).toBeCloseTo(500);
    expect(s.trade.realizedPnlUsd!).toBeGreaterThan(400);
  });
  it('valuation is unknown, not zero, when a price is missing', () => {
    const b = paperBuy(newPaperAccount(10_000, t0), q(1), 1_000, t0); if (!b.ok) throw new Error();
    const v = valueAccount(b.account, {});
    expect(v.equityUsd).toBeNull(); expect(v.unrealizedPnlUsd).toBeNull(); expect(v.unpricedMints).toEqual(['MintA']);
    expect(valueAccount(b.account, { MintA: 1 }).equityUsd).toBeGreaterThan(9_900);
  });
  it('exports realized lots as CSV labeled simulated and neutralizes formula injection', () => {
    const b = paperBuy(newPaperAccount(10_000, t0), { ...q(1), symbol: '=HYPERLINK()' }, 100, t0); if (!b.ok) throw new Error();
    const s = paperSell(b.account, q(1), 1, t0); if (!s.ok) throw new Error();
    const lots = realizedLots(s.account);
    expect(lots).toHaveLength(1); expect(lots[0].term).toBe('short');
    const csv = lotsToCsv(lots);
    expect(csv).toContain('SIMULATED'); expect(csv).toContain(`"'=HYPERLINK()"`);
  });
  it('rejects corrupt stored data', () => {
    expect(parseAccount('{bad')).toBeNull(); expect(parseAccount('{"version":2}')).toBeNull();
    expect(parseAccount(JSON.stringify(newPaperAccount()))).not.toBeNull();
  });
});

import { publishedCommunityPnl, tokensPerNetwork, COMMUNITY_NETWORKS } from '@/lib/community-overview';
describe('community overview', () => {
  it('counts distinct tokens per network and covers all six networks', () => {
    expect(COMMUNITY_NETWORKS.map((n) => n.id)).toEqual(['solana', 'ethereum', 'base', 'bnb', 'polygon', 'cronos']);
    expect(tokensPerNetwork([{ network: 'solana', mint: 'a' }, { network: 'solana', mint: 'a' }, { network: 'base', mint: 'b' }, { network: 'SOLANA', mint: 'c' }])).toEqual({ solana: 2, ethereum: 0, base: 1, bnb: 0, polygon: 0, cronos: 0 });
  });
  const D1 = '2026-11-01T12:00:00.000Z';
  const D2 = '2026-11-02T12:00:00.000Z';
  const row = (accountId: string, pnlUsd: number | null, closedAt = D1) => ({ accountId, pnlUsd, closedAt });
  it('suppresses collective P&L below five contributors so no individual result is inferable', () => {
    expect(publishedCommunityPnl([row('a', 10), row('b', -5), row('c', 1), row('d', 1)])).toEqual({ suppressed: true, minContributors: 5, series: [] });
    // A missing P&L is not a contribution (never a $0 trade).
    expect(publishedCommunityPnl([row('a', 10), row('b', -5), row('c', 1), row('d', 1), row('e', null)]).suppressed).toBe(true);
  });
  it('L-103a-ii: totals come from the published buckets only, so total minus last chart point is never one member', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => row(id, 10)).concat([row('solo', -37.5, D2)]);
    const p = publishedCommunityPnl(rows);
    if (p.suppressed) throw new Error('expected figures');
    expect(p.series.map((x) => x.value)).toEqual([50]);
    expect(p.netUsd).toBe(50);
    expect(p.netUsd - p.series[p.series.length - 1].value).toBe(0);
    expect(p.closedTrades).toBe(5);
    expect(p.contributors).toBe(5);
    // Once four more people close on day 2 the held-back trade is released together with theirs, never alone.
    const later = publishedCommunityPnl(rows.concat(['w', 'x', 'y', 'z'].map((id) => row(id, 1, D2))));
    if (later.suppressed) throw new Error('expected figures');
    expect(later.series.map((x) => x.value)).toEqual([50, 17]);
    expect(later.closedTrades).toBe(10);
  });
  it('split is all-or-nothing: 5 winners and 1 loser hides both sides, so net minus gains reveals nobody', () => {
    // Audit's case: gains 50 and net 13 would give 13 - 50 = -37 for the lone loser.
    const p = publishedCommunityPnl(['a', 'b', 'c', 'd', 'e'].map((id) => row(id, 10)).concat([row('loser', -37.4)]));
    if (p.suppressed) throw new Error('expected figures');
    expect(p.netUsd).toBe(13);
    expect(p.closedTrades).toBe(6);
    expect(p.gainsUsd).toBeNull();
    expect(p.lossesUsd).toBeNull();
    expect(p.winningTrades).toBeNull();
    expect(p.losingTrades).toBeNull();
  });
  it('publishes finished UTC days only, so a later close the same day never moves the figures', () => {
    const now = new Date('2026-11-03T15:00:00.000Z');
    const today = '2026-11-03T09:00:00.000Z';
    const base = ['a', 'b', 'c', 'd', 'e'].map((id) => row(id, 13, D2));
    const before = publishedCommunityPnl(base.concat(['f', 'g', 'h', 'i', 'j'].map((id) => row(id, 2, today))), 86_400, 5, now);
    const after = publishedCommunityPnl(base.concat(['f', 'g', 'h', 'i', 'j'].map((id) => row(id, 2, today)), [row('late', -22, '2026-11-03T14:00:00.000Z')]), 86_400, 5, now);
    if (before.suppressed || after.suppressed) throw new Error('expected figures');
    expect(before.netUsd).toBe(65);
    expect(after.netUsd).toBe(65); // today's bucket (5+ accounts) is still not published
    expect(after.series.map((x) => x.time)).toEqual([Date.parse('2026-11-02T00:00:00.000Z') / 1000]);
    // Next day, today's whole bucket is released at once (six people), never a single trade.
    const tomorrow = publishedCommunityPnl(base.concat(['f', 'g', 'h', 'i', 'j'].map((id) => row(id, 2, today)), [row('late', -22, '2026-11-03T14:00:00.000Z')]), 86_400, 5, new Date('2026-11-04T01:00:00.000Z'));
    if (tomorrow.suppressed) throw new Error('expected figures');
    expect(tomorrow.netUsd).toBe(53);
  });
  it('ignores trades closed before the member became eligible, so a newly eligible member never changes past days', () => {
    const base = ['a', 'b', 'c', 'd', 'e'].map((id) => row(id, 13, D1));
    const late = { ...row('late', 80, D1), eligibleFrom: '2026-11-02T00:00:00.000Z' };
    const p = publishedCommunityPnl(base.concat([late]));
    if (p.suppressed) throw new Error('expected figures');
    expect(p.netUsd).toBe(65);
    expect(publishedCommunityPnl([...base, { ...row('x', 5, D1), eligibleFrom: null }])).toMatchObject({ suppressed: false, closedTrades: 5 });
  });
  it('floors each side of the split at five distinct people and rounds to whole dollars', () => {
    const oneWinner = publishedCommunityPnl([row('a', 100.4), row('b', -1), row('c', -2), row('d', -3), row('e', -4)]);
    if (oneWinner.suppressed) throw new Error('expected figures');
    expect(oneWinner.netUsd).toBe(90);
    expect(oneWinner.gainsUsd).toBeNull();
    expect(oneWinner.winningTrades).toBeNull();
    expect(oneWinner.lossesUsd).toBeNull(); // only four losers
    expect(oneWinner.losingTrades).toBeNull();
    const broad = publishedCommunityPnl(['a', 'b', 'c', 'd', 'e'].flatMap((id) => [row(id, 2.6), row(id, -1.2)]));
    if (broad.suppressed) throw new Error('expected figures');
    expect(broad).toMatchObject({ netUsd: 7, gainsUsd: 13, lossesUsd: -6, winningTrades: 5, losingTrades: 5, closedTrades: 10 });
  });
});

import { memberEligibleFrom } from '@/lib/community-scope';
describe('community eligibility window', () => {
  it('starts at the later of account age + 7 days and the opt-in time, and never without an opt-in time', () => {
    const created = new Date('2026-11-01T00:00:00.000Z');
    expect(memberEligibleFrom(created, new Date('2026-11-02T00:00:00.000Z'))?.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    expect(memberEligibleFrom(created, new Date('2026-11-20T00:00:00.000Z'))?.toISOString()).toBe('2026-11-20T00:00:00.000Z');
    expect(memberEligibleFrom(created, null)).toBeNull();
  });
});
