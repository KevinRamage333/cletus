import { describe, expect, it, vi } from 'vitest';
import { decide, mergeRequests, newRequest, processRequests, remoteWithdrawEnabled, parseAllowlist, dailyCapLamports, type OwnerWithdrawRequest } from '../src/lib/owner-withdraw-queue';
import { checkSimWithdraw } from '../src/lib/sim-withdraw';

const DEST = 'GJwtCupMcNGbhGX1vapg2ueK2pedx2tgMkzGjhugnxaA';
const OTHER = 'GdDBJt1nCibTENMKnGRPoNkjaCskTXwrdF1x1UHgY7Hq';
const NOW = Date.parse('2026-11-12T12:00:00Z');
const mk = (sol: number, to = DEST, at = NOW) => { const r = newRequest({ wallet: 'main', to, amountSol: sol, by: 'owner' }, at); if (!r.ok) throw new Error(r.error); return r.request; };

function harness(enabled = true, cap = 1e9) {
  let ledger: OwnerWithdrawRequest[] = [];
  const send = vi.fn(async () => 'SIG');
  const deps = { enabled, allowlist: [DEST], capLamports: cap, readLedger: () => ledger, writeLedger: (r: OwnerWithdrawRequest[]) => { ledger = r; }, send, log: () => {}, now: () => NOW + 1000 };
  return { deps, send, ledger: () => ledger };
}

describe('owner withdraw queue', () => {
  it('validates new requests', () => {
    expect(newRequest({ wallet: 'main', to: 'nope', amountSol: 1, by: 'o' }).ok).toBe(false);
    expect(newRequest({ wallet: 'main', to: DEST, amountSol: 0, by: 'o' }).ok).toBe(false);
    expect(mk(0.25).lamports).toBe(250_000_000);
  });
  it('is off by default and never on under test', () => {
    expect(remoteWithdrawEnabled({})).toBe(false);
    expect(remoteWithdrawEnabled({ OWNER_REMOTE_WITHDRAW: 'on', VITEST: 'true' })).toBe(false);
    expect(remoteWithdrawEnabled({ OWNER_REMOTE_WITHDRAW: 'on', VERCEL: '1' })).toBe(false);
    expect(remoteWithdrawEnabled({ OWNER_REMOTE_WITHDRAW: 'on' })).toBe(true);
    expect(parseAllowlist({ OWNER_WITHDRAW_ALLOWLIST: `${DEST}, junk ,${OTHER}` })).toEqual([DEST, OTHER]);
    expect(dailyCapLamports({})).toBe(500_000_000);
  });
  it('refuses when disabled, off-allowlist, over cap, expired, or repeated', () => {
    const base = { enabled: true, allowlist: [DEST], capLamports: 1e9, ledger: [], now: NOW + 1000 };
    expect(decide(mk(0.1), { ...base, enabled: false })).toMatchObject({ execute: false, status: 'refused' });
    expect(decide(mk(0.1, OTHER), base)).toMatchObject({ execute: false, status: 'refused' });
    expect(decide(mk(2), base)).toMatchObject({ execute: false, status: 'refused' });
    expect(decide(mk(0.1), { ...base, now: NOW + 16 * 60_000 })).toMatchObject({ execute: false, status: 'expired' });
    const r = mk(0.1);
    expect(decide(r, { ...base, ledger: [{ ...r, status: 'failed' }] })).toMatchObject({ execute: false });
    expect(decide(mk(0.6), { ...base, ledger: [{ ...mk(0.5), status: 'sent', updatedAt: new Date(NOW).toISOString() }] })).toMatchObject({ execute: false });
    expect(decide(mk(0.1), base)).toEqual({ execute: true });
  });
  it('processes once, writes the ledger before sending, and never resends (mock send only)', async () => {
    const h = harness();
    const r = mk(0.1);
    h.deps.send.mockImplementation(async () => { expect(h.ledger().find((x) => x.id === r.id)?.status).toBe('executing'); return 'SIG'; });
    const out = await processRequests([r], h.deps);
    expect(out[0]).toMatchObject({ status: 'sent', signature: 'SIG' });
    const again = await processRequests([r], h.deps);
    expect(again[0].status).toBe('refused');
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('does not send when disabled', async () => {
    const h = harness(false);
    const out = await processRequests([mk(0.1)], h.deps);
    expect(out[0].status).toBe('refused');
    expect(h.send).not.toHaveBeenCalled();
  });
  it('merge never regresses status', () => {
    const r = mk(0.1);
    const merged = mergeRequests([{ ...r, status: 'sent' }], [r]);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('sent');
  });
});

describe('simulated user withdrawals', () => {
  const u = { walletPublicKey: DEST };
  it('only to the user\'s own wallet, within paper cash', () => {
    expect(checkSimWithdraw({ chain: 'solana', to: OTHER, amountUsd: 5 }, u, 100).ok).toBe(false);
    expect(checkSimWithdraw({ chain: 'solana', to: DEST, amountUsd: 500 }, u, 100).ok).toBe(false);
    expect(checkSimWithdraw({ chain: 'solana', to: DEST, amountUsd: 5 }, u, 100)).toMatchObject({ ok: true, cents: 500 });
    expect(checkSimWithdraw({ chain: 'base', to: '0xabc', amountUsd: 5 }, u, 100).ok).toBe(false);
    expect(checkSimWithdraw({ chain: 'base', to: '0x' + 'a'.repeat(40), amountUsd: 5 }, { walletPublicKey: null }, 100).ok).toBe(true);
  });
});
