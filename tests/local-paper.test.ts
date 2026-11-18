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

import { collectivePnl, tokensPerNetwork, COMMUNITY_NETWORKS } from '@/lib/community-overview';
describe('community overview', () => {
  it('counts distinct tokens per network and covers all six networks', () => {
    expect(COMMUNITY_NETWORKS.map((n) => n.id)).toEqual(['solana', 'ethereum', 'base', 'bnb', 'polygon', 'cronos']);
    expect(tokensPerNetwork([{ network: 'solana', mint: 'a' }, { network: 'solana', mint: 'a' }, { network: 'base', mint: 'b' }, { network: 'SOLANA', mint: 'c' }])).toEqual({ solana: 2, ethereum: 0, base: 1, bnb: 0, polygon: 0, cronos: 0 });
  });
  it('suppresses collective P&L below five contributors so no individual result is inferable', () => {
    expect(collectivePnl([10, -5], 4)).toEqual({ suppressed: true, minContributors: 5 });
    expect(collectivePnl([10, -5, null], 5)).toEqual({ suppressed: false, netUsd: 5, gainsUsd: 10, lossesUsd: -5, closedTrades: 2 });
  });
});
