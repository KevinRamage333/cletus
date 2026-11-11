import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import {
  addressesEqual, canonicalAddress, DEFAULT_OWNER_WALLET, isOwnerWallet, signOwnerSession, verifyOwnerSession,
} from '@/lib/owner-auth';
import { applyHaltCommand, EMPTY_HALT, mergeHalt, ownerHaltReason, shouldBlockNewEntries, shouldCloseOpenPositions } from '@/lib/owner-halt';
import { liveWatchFromAccountStatus, stopTakeLevels, sumTodayPnl, winLoss, curveFromClosed } from '@/lib/live-watch';
import { demoGateDecision, gateDecision } from '@/lib/gate';
import { parseLiveTradeLine, parseLiveTrades, equityCurveFromEvents } from '@/lib/live-trades';
import { issueSiwsChallenge, verifySiwsResponse } from '@/lib/siws';

const secret = 'test-owner-session-secret-which-is-at-least-32ch';

describe('owner wallet gate', () => {
  it('resolves only the configured owner address and rejects others', () => {
    const owner = DEFAULT_OWNER_WALLET;
    expect(canonicalAddress(owner)).toBe(owner);
    expect(isOwnerWallet(owner, {})).toBe(true);
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
    const addr = DEFAULT_OWNER_WALLET;
    const token = await signOwnerSession(addr, secret, 60, 1_700_000_000, 'nonce-1');
    const sess = await verifyOwnerSession(token, secret, 1_700_000_010);
    expect(sess?.typ).toBe('owner');
    expect(sess?.addr).toBe(addr);
    expect(sess?.nonce).toBe('nonce-1');
    expect(sess?.exp).toBe(1_700_000_060);
    expect(await verifyOwnerSession(token, secret, 1_700_000_061)).toBeNull();
    const [body, sig] = token.split('.');
    expect(await verifyOwnerSession(`${body}.${sig.slice(0, -2)}aa`, secret, 1_700_000_010)).toBeNull();
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
