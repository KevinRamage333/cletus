import { describe, it, expect, vi } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  validateDestination, computeSend, issueToken, verifyToken, executeWithdraw, reserveLamports, cooldownOk,
  LAMPORTS_PER_SOL, RENT_EXEMPT_MIN_LAMPORTS, BASE_FEE_LAMPORTS, type WithdrawDeps, type WithdrawPlan,
} from '@/lib/withdraw';
import { demoGateDecision } from '@/lib/gate';

const own = Keypair.generate().publicKey.toBase58();
const dest = Keypair.generate().publicKey.toBase58();
const SECRET = 'test-secret-0123456789abcdef';
const RES = reserveLamports({});

function mkDeps(over: Partial<WithdrawDeps> = {}, balance = 2 * LAMPORTS_PER_SOL) {
  const calls = { send: [] as Array<[string, number]>, logs: [] as string[], records: [] as Array<Record<string, unknown>>, closed: 0 };
  const d: WithdrawDeps = {
    liveEnabled: false, ownAddress: own,
    getBalanceLamports: async () => balance,
    closeAllPositions: async () => { calls.closed++; return 3; },
    sendTransfer: async (to, l) => { calls.send.push([to, l]); return 'SIG123'; },
    log: async (_l, m) => { calls.logs.push(m); },
    record: async (r) => { calls.records.push(r); },
    ...over,
  };
  return { d, calls };
}
const plan = (p: Partial<WithdrawPlan> = {}): WithdrawPlan => ({ uid: 'u1', to: dest, lamports: LAMPORTS_PER_SOL / 2, max: false, closePositions: false, mode: 'simulation', exp: Date.now() + 60_000, nonce: 'n', ...p });

describe('withdraw: address validation', () => {
  it('accepts a normal wallet address', () => expect(validateDestination(dest, own)).toEqual({ ok: true, address: dest }));
  it('rejects junk, wrong length, bad base58 characters', () => {
    for (const bad of ['', 'hello', '0OIl' + dest.slice(4), dest + 'x'.repeat(10), '   ']) expect(validateDestination(bad, own).ok).toBe(false);
  });
  it('rejects the trading wallet itself', () => expect(validateDestination(own, own)).toMatchObject({ ok: false, error: expect.stringMatching(/trading wallet/) }));
  it('rejects programs and mints', () => {
    for (const a of ['11111111111111111111111111111111', 'So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'])
      expect(validateDestination(a, own)).toMatchObject({ ok: false });
  });
  it('rejects off-curve (PDA) addresses', () => {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('x')], new PublicKey('11111111111111111111111111111111'));
    expect(validateDestination(pda.toBase58(), own)).toMatchObject({ ok: false, error: expect.stringMatching(/off-curve/) });
  });
});

describe('withdraw: amount math', () => {
  it('reserve is at least rent-exempt minimum + fee', () => {
    expect(reserveLamports({ WITHDRAW_FEE_RESERVE_SOL: '0' })).toBe(RENT_EXEMPT_MIN_LAMPORTS + BASE_FEE_LAMPORTS);
    expect(reserveLamports({})).toBe(2_000_000);
  });
  it('max = balance − reserve', () => {
    const r = computeSend({ balanceLamports: 1 * LAMPORTS_PER_SOL, max: true, reserveLamports: RES });
    expect(r).toMatchObject({ ok: true, lamports: LAMPORTS_PER_SOL - RES });
  });
  it('a fixed amount must be > 0 and ≤ spendable', () => {
    expect(computeSend({ balanceLamports: LAMPORTS_PER_SOL, amountSol: 0.5, reserveLamports: RES })).toMatchObject({ ok: true, lamports: 500_000_000 });
    expect(computeSend({ balanceLamports: LAMPORTS_PER_SOL, amountSol: 0, reserveLamports: RES }).ok).toBe(false);
    expect(computeSend({ balanceLamports: LAMPORTS_PER_SOL, amountSol: -1, reserveLamports: RES }).ok).toBe(false);
    expect(computeSend({ balanceLamports: LAMPORTS_PER_SOL, amountSol: 0.999, reserveLamports: RES })).toMatchObject({ ok: false, error: expect.stringMatching(/Max you can send/) });
  });
  it('balance at or below reserve cannot withdraw', () => {
    expect(computeSend({ balanceLamports: RES, max: true, reserveLamports: RES }).ok).toBe(false);
    expect(computeSend({ balanceLamports: 0, amountSol: 0.1, reserveLamports: RES }).ok).toBe(false);
  });
});

describe('withdraw: confirmation token', () => {
  const base = { uid: 'u1', to: dest, lamports: 1000, max: false, closePositions: false, mode: 'simulation' as const };
  it('round-trips once, then is single-use', () => {
    const used = new Map<string, number>();
    const t = issueToken(base, SECRET);
    expect(verifyToken(t, SECRET, 'u1', Date.now(), used)).toMatchObject({ ok: true, plan: { to: dest, lamports: 1000 } });
    expect(verifyToken(t, SECRET, 'u1', Date.now(), used)).toMatchObject({ ok: false, error: expect.stringMatching(/already used/) });
  });
  it('rejects tampering, wrong secret, other user, and expiry', () => {
    const t = issueToken(base, SECRET);
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), lamports: 9e9 })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, SECRET, 'u1', Date.now(), new Map()).ok).toBe(false);
    expect(verifyToken(t, 'other-secret-xxxxxxxxxxxx', 'u1', Date.now(), new Map()).ok).toBe(false);
    expect(verifyToken(t, SECRET, 'u2', Date.now(), new Map())).toMatchObject({ ok: false, error: expect.stringMatching(/another user/) });
    expect(verifyToken(t, SECRET, 'u1', Date.now() + 3 * 60_000, new Map())).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    expect(verifyToken('garbage', SECRET, 'u1').ok).toBe(false);
  });
});

describe('withdraw: execution', () => {
  it('simulation mode never sends, but logs and records', async () => {
    const { d, calls } = mkDeps();
    const r = await executeWithdraw(plan(), d, RES);
    expect(r).toMatchObject({ status: 'simulated', signature: null, lamports: 500_000_000 });
    expect(calls.send).toHaveLength(0);
    expect(calls.records[0]).toMatchObject({ status: 'simulated', mode: 'simulation', to: dest });
    expect(calls.logs.join(' ')).toMatch(/SIMULATED withdrawal/);
  });
  it('closes all positions first when asked, then re-checks the balance', async () => {
    let bal = RES;                                   // nothing spendable until positions are sold
    const { d, calls } = mkDeps({ getBalanceLamports: async () => bal, closeAllPositions: async () => { bal = LAMPORTS_PER_SOL; return 2; } });
    const r = await executeWithdraw(plan({ closePositions: true, max: true, lamports: 0 }), d, RES);
    expect(r).toMatchObject({ status: 'simulated', closedPositions: 2, lamports: LAMPORTS_PER_SOL - RES });
    expect(calls.send).toHaveLength(0);
  });
  it('live mode is refused unless WITHDRAW_LIVE_ENABLED', async () => {
    const { d, calls } = mkDeps({ liveEnabled: false });
    const r = await executeWithdraw(plan({ mode: 'live' }), d, RES);
    expect(r.status).toBe('refused');
    expect(calls.send).toHaveLength(0);
    expect(calls.records[0]).toMatchObject({ status: 'refused' });
  });
  it('live + enabled sends exactly the computed lamports to the validated address', async () => {
    const { d, calls } = mkDeps({ liveEnabled: true });
    const r = await executeWithdraw(plan({ mode: 'live', max: true, lamports: 0 }), d, RES);
    expect(r).toMatchObject({ status: 'sent', signature: 'SIG123' });
    expect(calls.send).toEqual([[dest, 2 * LAMPORTS_PER_SOL - RES]]);
    expect(calls.records[0]).toMatchObject({ status: 'sent', signature: 'SIG123' });
  });
  it('a failed live send is recorded as failed, not sent', async () => {
    const { d, calls } = mkDeps({ liveEnabled: true, sendTransfer: vi.fn(async () => { throw new Error('blockhash not found'); }) });
    const r = await executeWithdraw(plan({ mode: 'live' }), d, RES);
    expect(r.status).toBe('failed');
    expect(calls.records[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/blockhash/) });
  });
  it('re-validates the destination at execution (cannot target own wallet)', async () => {
    const { d, calls } = mkDeps({ liveEnabled: true });
    const r = await executeWithdraw(plan({ mode: 'live', to: own }), d, RES);
    expect(r.status).toBe('refused');
    expect(calls.send).toHaveLength(0);
  });
  it('insufficient balance at execution is refused', async () => {
    const { d } = mkDeps({}, RES);
    expect((await executeWithdraw(plan(), d, RES)).status).toBe('refused');
  });
  it('per-user cooldown', () => {
    const m = new Map<string, number>();
    expect(cooldownOk('u1', 1_000_000, 30_000, m)).toBe(true);
    expect(cooldownOk('u1', 1_010_000, 30_000, m)).toBe(false);
    expect(cooldownOk('u2', 1_010_000, 30_000, m)).toBe(true);
    expect(cooldownOk('u1', 1_031_000, 30_000, m)).toBe(true);
  });
  it('on the public (Vercel demo) site the withdraw APIs are unavailable', () => {
    for (const p of ['/api/protected/withdraw/status', '/api/protected/withdraw/preview', '/api/protected/withdraw/confirm']) expect(demoGateDecision(p)).toEqual({ action: 'soon' });
    expect(demoGateDecision('/app/wallet/engine')).toEqual({ action: 'redirect', to: '/app?soon=%2Fapp%2Fwallet%2Fengine' });
    // The connect-only wallet screen is public in the demo; withdrawals are not.
    expect(demoGateDecision('/app/wallet')).toEqual({ action: 'next' });
  });
});
