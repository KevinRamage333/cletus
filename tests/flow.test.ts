import { describe, it, expect } from 'vitest';
import { swapFromParsed, flowFeatures, whaleGate, whaleExitDecision, discoverSmartMoney, freshBuyCluster, describeFlow, WSOL, type WhaleSwap } from '@/lib/whales';
import { buildQuery, parseCounts, hypeFeatures, hypeDivergence, hypeGate, authorSample, xConfig } from '@/lib/social/x';

const MINT = 'MintAAAA', POOL = 'PoolAAAA';
const sw = (o: Partial<WhaleSwap>): WhaleSwap => ({ signature: Math.random().toString(36), mint: MINT, pool: POOL, wallet: 'w', side: 'buy', tokenAmount: 1000, solAmount: 0, usd: 100, blockTime: 1000, slot: null, ...o });

describe('whales', () => {
  it('extracts the fee payer swap with the SOL leg', () => {
    const tx = { signature: 's', parserStatus: 'OK', parsed: { blockTime: 1000, feePayer: 'W', tokenTransfers: [
      { fromUserAccount: 'W', toUserAccount: 'P', rawTokenAmount: 2_000_000_000, decimals: 9, mint: WSOL },
      { fromUserAccount: 'P', toUserAccount: 'W', rawTokenAmount: 5_000_000, decimals: 6, mint: MINT }] } };
    const s = swapFromParsed(tx, MINT, POOL, 0.01, 150)!;
    expect(s.side).toBe('buy'); expect(s.tokenAmount).toBe(5); expect(s.usd).toBeCloseTo(300);
    expect(swapFromParsed({ ...tx, parserStatus: 'ERROR' }, MINT, POOL, 0.01, 150)).toBeNull();
  });
  it('features use only past swaps and flag dev dumps for veto and fast exit', () => {
    const swaps = [sw({ wallet: 'dev', side: 'buy', tokenAmount: 1000, blockTime: 100 }), sw({ wallet: 'dev', side: 'sell', tokenAmount: 500, usd: 5000, blockTime: 1900 }), sw({ wallet: 'x', usd: 1e6, blockTime: 5000 })];
    const f = flowFeatures(MINT, swaps, [{ address: 'dev', kind: 'dev', mint: MINT }], { nowSec: 2000, windowMin: 30 });
    expect(f.devKnown).toBe(true);
    expect(f.buyUsd).toBe(0); // the future $1M buy is ignored
    expect(f.devSells).toBe(1); expect(f.devSoldPctOfBought).toBeCloseTo(0.5);
    expect(whaleGate(f).veto).toBe(true); expect(whaleExitDecision(f)).toBe('dev_exit');
    expect(describeFlow(f)).toMatch(/dev wallet SOLD/);
  });
  it('confirms on smart-money buys with buy-side flow, never vetoes without data', () => {
    const swaps = [sw({ wallet: 'a', usd: 4000, blockTime: 1990 }), sw({ wallet: 'b', usd: 4000, blockTime: 1995 }), sw({ wallet: 'c', side: 'sell', usd: 500, blockTime: 1995 })];
    const f = flowFeatures(MINT, swaps, [{ address: 'a', kind: 'smart', mint: '' }, { address: 'b', kind: 'smart', mint: '' }], { nowSec: 2000 });
    const v = whaleGate(f); expect(v.confirm).toBe(true); expect(v.veto).toBe(false);
    expect(describeFlow(f)).toMatch(/2 smart-money wallets bought \$8\.0k/);
    expect(whaleGate(null).veto).toBe(false);
  });
  it('discovers early buyers who sold well and fresh-wallet bundles', () => {
    const s: WhaleSwap[] = [];
    for (const m of ['A', 'B']) s.push(sw({ mint: m, wallet: 'smart', blockTime: 0, usd: 1000, tokenAmount: 100 }), sw({ mint: m, wallet: 'late', blockTime: 90, usd: 3000, tokenAmount: 100 }), sw({ mint: m, wallet: 'smart', side: 'sell', blockTime: 100, usd: 3000, tokenAmount: 100 }), sw({ mint: m, wallet: 'late', side: 'sell', blockTime: 100, usd: 1000, tokenAmount: 100 }));
    const out = discoverSmartMoney(s);
    expect(out.map((w) => w.address)).toEqual(['smart']);
    const fresh = new Set(['f1', 'f2', 'f3', 'f4', 'f5']);
    const c = freshBuyCluster([...fresh].map((w, i) => sw({ wallet: w, blockTime: 10 + i, usd: 200 })), fresh)!;
    expect(c.buyers).toBe(5); expect(c.sizeCv).toBeCloseTo(0);
  });
});

describe('x hype', () => {
  it('is off without a token and builds cashtag + CA queries', () => {
    expect(xConfig({}).enabled).toBe(false);
    expect(buildQuery('BONK', 'Mint1')).toBe('($BONK OR Mint1) -is:retweet');
    expect(buildQuery('🐸 frog', 'Mint1')).toBe('(Mint1) -is:retweet');
  });
  it('velocity, acceleration and divergence', () => {
    const now = 10_000;
    const b = [...Array.from({ length: 60 }, (_, i) => ({ start: now - 7200 + i * 60, end: now - 7200 + (i + 1) * 60, count: 0.2 > 0 ? (i % 5 === 0 ? 1 : 0) : 0 })),
      ...Array.from({ length: 60 }, (_, i) => ({ start: now - 3600 + i * 60, end: now - 3600 + (i + 1) * 60, count: 1 }))];
    const h = hypeFeatures(parseCounts({ data: b.map((x) => ({ start: new Date(x.start * 1000).toISOString(), end: new Date(x.end * 1000).toISOString(), tweet_count: x.count })) }), now);
    expect(h.posts1h).toBe(60); expect(h.accel1h).toBeCloseTo(5);
    const exitLiq = hypeDivergence(h, null, { priceChangeH1: 2, buyRatio1h: 0.3 });
    expect(exitLiq.kind).toBe('exit_liquidity'); expect(exitLiq.message).toMatch(/sells dominate: hype is being used as exit liquidity/);
    expect(hypeGate(exitLiq).veto).toBe(true);
    expect(hypeDivergence(h, null, { priceChangeH1: 8, buyRatio1h: 0.7 }).kind).toBe('confirmed');
    expect(hypeDivergence({ ...h, posts1h: 2, accel1h: 1 }, null, { priceChangeH1: 20, buyRatio1h: 0.7 }).kind).toBe('early_move');
  });
  it('flags bot-like and copy-pasted authors', () => {
    const now = Date.parse('2026-11-11T00:00:00Z');
    const a = authorSample({ data: [{ author_id: '1', text: 'buy $X now moon soon guys' }, { author_id: '2', text: 'buy $X now moon soon guys' }, { author_id: '3', text: 'interesting chart' }],
      includes: { users: [{ id: '1', created_at: '2026-11-01T00:00:00Z', public_metrics: { followers_count: 3 } }, { id: '2', created_at: '2026-11-05T00:00:00Z', public_metrics: { followers_count: 5 } }, { id: '3', created_at: '2020-01-01T00:00:00Z', public_metrics: { followers_count: 5000 } }] } }, now);
    expect(a.uniqueAuthors).toBe(3); expect(a.botShare).toBeCloseTo(2 / 3); expect(a.dupShare).toBeCloseTo(2 / 3); expect(a.organicRatio).toBeCloseTo(1 / 3);
  });
});
