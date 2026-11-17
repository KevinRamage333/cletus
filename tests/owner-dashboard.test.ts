import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import {
  addressesEqual, canonicalAddress, isOwnerWallet, signOwnerSession, verifyOwnerSession,
} from '@/lib/owner-auth';
import { applyHaltCommand, EMPTY_HALT, mergeHalt, ownerHaltReason, shouldBlockNewEntries, shouldCloseOpenPositions } from '@/lib/owner-halt';
import { liveWatchFromAccountStatus, stopTakeLevels, sumTodayPnl, winLoss, curveFromClosed } from '@/lib/live-watch';
import { demoGateDecision, gateDecision } from '@/lib/gate';
import { parseLiveTradeLine, parseLiveTrades, equityCurveFromEvents } from '@/lib/live-trades';
import { issueSiwsChallenge, verifySiwsResponse } from '@/lib/siws';

const secret = 'test-owner-session-secret-which-is-at-least-32ch';

describe('owner wallet gate', () => {
  it('resolves only the configured owner address and rejects others', () => {
    const owner = Keypair.generate().publicKey.toBase58();
    expect(canonicalAddress(owner)).toBe(owner);
    expect(isOwnerWallet(owner, {})).toBe(false);
    expect(isOwnerWallet(owner, { OWNER_WALLET: owner, PAYOUT_WALLET: 'other' })).toBe(true);
    expect(isOwnerWallet('not-a-key', {})).toBe(false);
    expect(isOwnerWallet(Keypair.generate().publicKey.toBase58(), { OWNER_WALLET: owner })).toBe(false);
    expect(addressesEqual(owner, owner)).toBe(true);
    expect(canonicalAddress('  ')).toBeNull();
  });
  it('OWNER_WALLET wins over PAYOUT_WALLET', () => {
    const a = Keypair.generate().publicKey.toBase58();
    const b = Keypair.generate().publicKey.toBase58();
    expect(isOwnerWallet(a, { OWNER_WALLET: a, PAYOUT_WALLET: b })).toBe(true);
    expect(isOwnerWallet(b, { OWNER_WALLET: a, PAYOUT_WALLET: b })).toBe(false);
    expect(isOwnerWallet(b, { PAYOUT_WALLET: b })).toBe(true);
  });
});

describe('owner session cookie', () => {
  it('round-trips, includes a nonce and expiry, and rejects a different address or tampering', async () => {
    const addr = Keypair.generate().publicKey.toBase58();
    const token = await signOwnerSession(addr, secret, 60, 1_700_000_000, 'nonce-1');
    const sess = await verifyOwnerSession(token, secret, 1_700_000_010, { OWNER_WALLET: addr });
    expect(sess?.typ).toBe('owner');
    expect(sess?.addr).toBe(addr);
    expect(sess?.nonce).toBe('nonce-1');
    expect(sess?.exp).toBe(1_700_000_060);
    expect(await verifyOwnerSession(token, secret, 1_700_000_061, { OWNER_WALLET: addr })).toBeNull();
    const [body, sig] = token.split('.');
    expect(await verifyOwnerSession(`${body}.${sig.slice(0, -2)}aa`, secret, 1_700_000_010, { OWNER_WALLET: addr })).toBeNull();
    expect(await verifyOwnerSession('nope', secret)).toBeNull();
  });
});

describe('owner SIWS login is auth-only and bound to the owner uid', () => {
  it('accepts a valid signature for uid=owner', async () => {
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const issued = await issueSiwsChallenge({
      uid: 'owner', address, domain: 'localhost', uri: 'http://localhost:3000/owner',
      secret, ttlSec: 300, now: new Date('2026-11-11T18:00:00.000Z'),
    });
    const sig = nacl.sign.detached(new TextEncoder().encode(issued.message), kp.secretKey);
    expect(await verifySiwsResponse({
      message: issued.message, signature: Buffer.from(sig).toString('base64'), challenge: issued.challenge,
      address, uid: 'owner', secret, now: Date.parse('2026-11-11T18:01:00.000Z'),
    })).toBeNull();
    expect(await verifySiwsResponse({
      message: issued.message, signature: Buffer.from(sig).toString('base64'), challenge: issued.challenge,
      address, uid: 'user-1', secret, now: Date.parse('2026-11-11T18:01:00.000Z'),
    })).toMatch(/different session/);
    expect(issued.message).toMatch(/is not a transaction/);
  });
});

describe('sell-all / halt flag', () => {
  it('is idempotent, audited, closes positions and blocks entries, and resume is also idempotent', () => {
    const first = applyHaltCommand(EMPTY_HALT, { action: 'halt', reason: 'sell all', by: 'GJwt…', at: '2026-11-11T18:00:00.000Z' });
    expect(first.changed).toBe(true);
    expect(first.already).toBe(false);
    expect(first.state.halted).toBe(true);
    expect(first.state.rev).toBe(1);
    expect(first.audit.result).toBe('applied');
    expect(first.state.reason).toBe(ownerHaltReason('sell all'));
    expect(shouldCloseOpenPositions(first.state)).toBe(true);
    expect(shouldBlockNewEntries(first.state)).toBe(true);

    const again = applyHaltCommand(first.state, { action: 'halt', reason: 'sell all again', by: 'GJwt…', at: '2026-11-11T18:00:05.000Z' });
    expect(again.changed).toBe(false);
    expect(again.already).toBe(true);
    expect(again.audit.result).toBe('idempotent');
    expect(again.state.rev).toBe(1);

    const resume = applyHaltCommand(again.state, { action: 'resume', by: 'GJwt…', at: '2026-11-11T18:01:00.000Z' });
    expect(resume.changed).toBe(true);
    expect(resume.state.halted).toBe(false);
    expect(resume.state.rev).toBe(2);
    expect(shouldBlockNewEntries(resume.state)).toBe(false);

    const resumeAgain = applyHaltCommand(resume.state, { action: 'resume', by: 'GJwt…' });
    expect(resumeAgain.already).toBe(true);
    expect(resumeAgain.changed).toBe(false);
  });
  it('merge prefers the higher revision and a halt on a tie (fail-safe)', () => {
    const a = applyHaltCommand(EMPTY_HALT, { action: 'halt', by: 'a' }).state;
    const b = applyHaltCommand(a, { action: 'resume', by: 'b' }).state;
    expect(mergeHalt(a, b).rev).toBe(b.rev);
    expect(mergeHalt(a, b).halted).toBe(false);
    const tiedHalt = { ...b, halted: true, rev: b.rev };
    expect(mergeHalt(b, tiedHalt).halted).toBe(true);
  });
});

describe('live trade log and watch model', () => {
  it('parses a buy/sell/sweep jsonl and ignores junk', () => {
    const text = [
      '{"type":"buy","symbol":"BONK","mint":"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263","sizeUsd":5,"entryPrice":0.00002,"at":"2026-11-11T18:00:00.000Z","signature":"sig1"}',
      'not-json',
      '{"kind":"sell","symbol":"BONK","pnlUsd":0.6,"pnlPct":12,"at":"2026-11-11T18:10:00.000Z","exitTx":"sig2","equityUsd":10.6}',
      '{"event":"sweep","amountUsd":25,"at":"2026-11-11T19:00:00.000Z"}',
    ].join('\n');
    const ev = parseLiveTrades(text);
    expect(ev.map((e) => e.kind)).toEqual(['buy', 'sell', 'sweep']);
    expect(parseLiveTradeLine('{"foo":1}')).toBeNull();
    expect(equityCurveFromEvents(ev, 10).length).toBeGreaterThan(1);
  });
  it('builds a user-scoped watch model from account status without inventing trades', () => {
    const w = liveWatchFromAccountStatus({
      config: { mode: 'simulation', stopLossPct: 5, takeProfitPct: 20 },
      account: { equity: 12, realizedPnl: 2, unrealizedPnl: 0, startingBalance: 10, pnl: { day: 2 } },
      open: [],
      closed: [{ id: '1', symbol: 'WIF', mint: 'EKp', sizeUsd: 5, entryPrice: 1, exitPrice: 1.2, pnlUsd: 2, pnlPct: 20, closedAt: '2026-11-11T18:00:00.000Z', simulated: true, exitTx: '5VERv8NMvzbJMEkV8xnrLkEaWJHPGocrHyYxzHjsvAqf' }],
    }, { scope: 'user', label: 'Your trades' });
    expect(w.open).toBeNull();
    expect(w.closedTrades).toBe(1);
    expect(w.todayPnl).toBe(2);
    expect(w.wins).toBe(1);
    expect(w.simulatedBadge).toBe(true);
    expect(w.feed[0].solscan).toContain('solscan.io/tx/5VERv8NMvzbJMEkV8xnrLkEaWJHPGocrHyYxzHjsvAqf');
    expect(w.equityCurve.length).toBeGreaterThan(0);
  });
  it('computes 5/20 levels, today PnL in Chicago, and a curve from closes only', () => {
    const lv = stopTakeLevels(100, 5, 20);
    expect(lv.stopLoss).toBeCloseTo(95);
    expect(lv.takeProfit).toBeCloseTo(120);
    expect(winLoss([{ pnlUsd: 1 }, { pnlUsd: -1 }, { pnlUsd: 2 }]).wins).toBe(2);
    const today = '2026-11-11T18:00:00.000-06:00';
    expect(sumTodayPnl([{ pnlUsd: 3, at: '2026-11-11T12:00:00.000-06:00' }, { pnlUsd: 9, at: '2026-11-10T12:00:00.000-06:00' }], new Date(today))).toBe(3);
    expect(curveFromClosed(10, [{ closedAt: '2026-11-11T18:00:00.000Z', pnlUsd: 2 }], 12).at(-1)?.equityUsd).toBe(12);
  });
});

describe('owner and live routes are reachable in the gate', () => {
  it('are public in the logged-in gate (auth is enforced in the route)', () => {
    for (const p of ['/owner', '/live', '/api/owner/status', '/api/owner/halt', '/api/live', '/api/internal/owner-snapshot']) {
      expect(gateDecision(p, null, '2026-11-11.4')).toEqual({ action: 'next' });
    }
  });
  it('are public in demo mode (not redirected or 503)', () => {
    for (const p of ['/owner', '/live', '/api/owner/login', '/api/owner/status', '/api/live', '/api/internal/owner-snapshot']) {
      expect(demoGateDecision(p)).toEqual({ action: 'next' });
    }
  });
});

import { isolateLiveWatch, type LiveWatchModel } from '@/lib/live-watch';
import { LIVE_EMPTY_MESSAGE } from '@/lib/live-book';

function mixedWatch(overrides: Partial<LiveWatchModel> = {}): LiveWatchModel {
  const paper = [
    { id: 's1', kind: 'sell' as const, at: '2026-11-10T16:00:00.000Z', symbol: 'BONK', pnlUsd: -40.12, pnlPct: -8, win: false, simulated: true },
    { id: 's2', kind: 'sell' as const, at: '2026-11-10T17:00:00.000Z', symbol: 'WIF', pnlUsd: 12.40, pnlPct: 5, win: true, simulated: true },
    { id: 's3', kind: 'sell' as const, at: '2026-11-10T18:00:00.000Z', symbol: 'POPCAT', pnlUsd: -90.00, pnlPct: -15, win: false, simulated: true },
    { id: 's4', kind: 'sell' as const, at: '2026-11-10T19:00:00.000Z', symbol: 'MEW', pnlUsd: -50.11, pnlPct: -10, win: false, simulated: true },
    { id: 's5', kind: 'sell' as const, at: '2026-11-10T20:00:00.000Z', symbol: 'MOODENG', pnlUsd: -70.00, pnlPct: -12, win: false, simulated: true },
    { id: 's6', kind: 'sell' as const, at: '2026-11-11T16:00:00.000Z', symbol: 'FARTCOIN', pnlUsd: -37.00, pnlPct: -6, win: false, simulated: true },
  ];
  return {
    asOf: '2026-11-11T18:30:00.000Z',
    mode: 'simulation',
    scope: 'owner',
    label: 'Cletus (house)',
    equityUsd: 9.86,
    sol: 0.1174,
    solPriceUsd: 84,
    realizedPnl: -274.83,
    unrealizedPnl: 0,
    totalPnl: -274.83,
    todayPnl: -37,
    winRate: 1 / 6,
    wins: 1,
    losses: 5,
    closedTrades: 6,
    open: null,
    openAll: [],
    feed: paper,
    equityCurve: [{ t: '2026-11-10T15:00:00.000Z', equityUsd: 10000 }, { t: '2026-11-11T16:00:00.000Z', equityUsd: 9725.17 }],
    chartApiBase: '/api/owner/chart',
    simulatedBadge: true,
    ...overrides,
  };
}

describe('owner live book isolation', () => {
  it('defaults the owner desk to the live $10 wallet and hides the paper −$274.83 book', () => {
    const { live, simulation } = isolateLiveWatch(mixedWatch(), 9.86);
    expect(live.book).toBe('live');
    expect(live.mode).toBe('live');
    expect(live.simulatedBadge).toBe(false);
    expect(live.equityUsd).toBeCloseTo(9.86);
    expect(live.closedTrades).toBe(0);
    expect(live.feed).toEqual([]);
    expect(live.totalPnl).toBe(0);
    expect(live.winRate).toBeNull();
    expect(live.emptyMessage).toBe(LIVE_EMPTY_MESSAGE);
    expect(live.equityCurve[0]?.equityUsd).toBeCloseTo(9.86);
    expect(live.equityCurve.some((p) => p.equityUsd > 100)).toBe(false);
    expect(simulation.book).toBe('simulation');
    expect(simulation.simulatedBadge).toBe(true);
    expect(simulation.closedTrades).toBe(6);
    expect(simulation.totalPnl).toBeCloseTo(-274.83);
    expect(simulation.wins).toBe(1);
    expect(simulation.losses).toBe(5);
    expect(simulation.equityUsd).toBeCloseTo(9725.17);
    expect(simulation.equityCurve[0]?.equityUsd).toBeCloseTo(10000);
  });

  it('keeps a post-cutoff live close in the live book only', () => {
    const base = mixedWatch();
    const liveSell = { id: 'l1', kind: 'sell' as const, at: '2026-11-11T18:40:00.000Z', symbol: 'SOL', pnlUsd: 0.35, pnlPct: 3.5, win: true, simulated: false };
    const { live, simulation } = isolateLiveWatch({ ...base, feed: [...base.feed, liveSell] }, 10.21);
    expect(live.closedTrades).toBe(1);
    expect(live.totalPnl).toBeCloseTo(0.35);
    expect(live.emptyMessage).toBeNull();
    expect(simulation.closedTrades).toBe(6);
    expect(simulation.totalPnl).toBeCloseTo(-274.83);
  });
});

import { planForLiveEquity } from '@/lib/owner-status';

describe('owner plan card uses live equity, not the paper book', () => {
  it('resizes the money plan from the $10 live wallet instead of leftover ~$10k paper equity', () => {
    const paper = {
      enabled: true, sweepArmed: true, sweepPausedReason: null,
      payoutWallet: 'GJwtCupMcNGbhGX1vapg2ueK2pedx2tgMkzGjhugnxaA',
      tradingWallet: 'GdDBJt1nCibTENMKnGRPoNkjaCskTXwrdF1x1UHgY7Hq',
      equityUsd: 9725.17, currentTier: { minEquityUsd: 20, sizeUsd: 7 }, tradeSizeUsd: 1947,
      feeReserveSol: 0.01, feeReserveUsd: 1.8, currentBaseUsd: 0, nextSweepTargetUsd: 50,
      totalPaidUsd: 0, paidTodayUsd: 0, openPositions: 0, stopLossPct: 5, takeProfitPct: 20,
      maxOpenPositions: 1, mcapPreset: 'BALANCED' as const, payouts: [],
    };
    const live = planForLiveEquity(paper, 9.86, 85.11);
    expect(live?.equityUsd).toBeCloseTo(9.86);
    expect(live?.tradeSizeUsd).toBeLessThanOrEqual(9.86);
    expect(live?.tradeSizeUsd).toBeGreaterThan(0);
    expect(live?.tradeSizeUsd).not.toBe(1947);
    expect(live?.currentTier?.minEquityUsd).toBeLessThan(20);
    expect(live?.nextSweepTargetUsd).toBe(50);
  });
});

import { combinedWallets, emptyKolDesk, kolWatchFromDesk, kolTotals, type KolDesk } from '@/lib/owner-kol';
import { KOL_TRADING_WALLET } from '@/lib/owner-withdraw-queue';
import { OWNER_TRADING_WALLET } from '@/lib/owner-plan';

function sampleKol(): KolDesk {
  const history = [
    { id: 'k1', symbol: 'POPVAX', mint: 'Mint1111111111111111111111111111111111111', openedAt: '2026-11-12T13:00:00.000Z', closedAt: '2026-11-12T13:20:00.000Z', sizeUsd: 10, pnlUsd: 1.5, pnlPct: 15, exitReason: 'take-profit', exitTxUrl: 'https://solscan.io/tx/sigA' },
    { id: 'k2', symbol: 'FLOP', mint: 'Mint2222222222222222222222222222222222222', openedAt: '2026-11-12T14:00:00.000Z', closedAt: '2026-11-12T14:10:00.000Z', sizeUsd: 10, pnlUsd: -0.7, pnlPct: -7, exitReason: 'stop-loss', exitTxUrl: null },
  ];
  return {
    enabled: true,
    source: 'hype',
    wallet: KOL_TRADING_WALLET,
    sol: 0.30,
    usd: 21.22,
    round: { at: '2026-11-14T23:00:00.000Z', summary: '2 scanned', rows: [] },
    open: [{
      id: 'k3', symbol: 'NEWTKN', mint: 'Mint3333333333333333333333333333333333333',
      entryPrice: 1, lastPrice: 1.05, sizeUsd: 8, valueUsd: 8.4, pnlUsd: 0.4, pnlPct: 5,
      openedAt: '2026-11-14T22:00:00.000Z',
    }],
    history,
    totals: kolTotals(history),
  };
}

describe('KOL wallet watch and combined totals', () => {
  it('maps the KOL desk into a LiveWatch model without inventing trades', () => {
    const w = kolWatchFromDesk(sampleKol(), { solPriceUsd: 70.73, asOf: '2026-11-14T23:30:00.000Z' });
    expect(w.label).toBe('KOL / pump.fun wallet');
    expect(w.walletAddress).toBe(KOL_TRADING_WALLET);
    expect(w.sol).toBeCloseTo(0.30);
    expect(w.equityUsd).toBeCloseTo(21.22);
    expect(w.mode).toBe('live');
    expect(w.simulatedBadge).toBe(false);
    expect(w.closedTrades).toBe(2);
    expect(w.wins).toBe(1);
    expect(w.losses).toBe(1);
    expect(w.realizedPnl).toBeCloseTo(0.8);
    expect(w.unrealizedPnl).toBeCloseTo(0.4);
    expect(w.totalPnl).toBeCloseTo(1.2);
    expect(w.open?.symbol).toBe('NEWTKN');
    expect(w.open?.stopLoss).toBeCloseTo(0.93);
    expect(w.open?.takeProfit).toBeCloseTo(1.15);
    expect(w.feed.map((f) => f.symbol)).toEqual(['FLOP', 'POPVAX']);
    expect(w.feed[1].solscan).toContain('solscan.io/tx/sigA');
    expect(w.emptyMessage).toBeNull();
  });

  it('still renders an empty KOL book when there are no trades', () => {
    const w = kolWatchFromDesk({ ...emptyKolDesk(), sol: 0.15, usd: 10.5 });
    expect(w.closedTrades).toBe(0);
    expect(w.open).toBeNull();
    expect(w.feed).toEqual([]);
    expect(w.equityUsd).toBeCloseTo(10.5);
    expect(w.emptyMessage).toBe('No KOL trades yet.');
  });

  it('adds main and KOL balances into a combined total', () => {
    const c = combinedWallets(
      { sol: 0.71, equityUsd: 50.22, realizedPnl: 0.35, totalPnl: 0.35, openAll: [], open: null },
      sampleKol(),
    );
    expect(c.sol).toBeCloseTo(1.01);
    expect(c.usd).toBeCloseTo(71.44);
    expect(c.mainSol).toBeCloseTo(0.71);
    expect(c.kolSol).toBeCloseTo(0.30);
    expect(c.mainUsd).toBeCloseTo(50.22);
    expect(c.kolUsd).toBeCloseTo(21.22);
    expect(c.realizedPnl).toBeCloseTo(1.15);
    expect(c.totalPnl).toBeCloseTo(1.55);
    expect(c.openPositions).toBe(1);
  });

  it('keeps combined totals null when both wallets are unknown, and does not invent a KOL wallet address', () => {
    const empty = combinedWallets({ sol: null, equityUsd: null, realizedPnl: 0, totalPnl: 0, openAll: [] }, emptyKolDesk());
    expect(empty.sol).toBeNull();
    expect(empty.usd).toBeNull();
    expect(emptyKolDesk().wallet).toBe(KOL_TRADING_WALLET);
    expect(OWNER_TRADING_WALLET).not.toBe(KOL_TRADING_WALLET);
  });
});
