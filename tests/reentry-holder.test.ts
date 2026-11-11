import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { reentryBan, reentryCooldownHours } from '@/lib/reentry';
import { holderSellDecision, pollHolders, takeHolderExit, _resetHolderStore, type HolderSnap } from '@/lib/holder-watch';
import { txAccountKeys } from '@/lib/profit-sweep';

const H = 3_600_000;
describe('re-entry cooldown', () => {
  const now = Date.parse('2026-11-11T23:00:00Z');
  it('bans 24h after a losing live close, not after a win', () => {
    expect(reentryBan({ closedAt: new Date(now - 2 * H), pnlUsd: -0.81, exitReason: 'manual_take_profit' }, now, 24)!.minutesLeft).toBe(22 * 60);
    expect(reentryBan({ closedAt: new Date(now - 2 * H), pnlUsd: -1, exitReason: 'stop_loss' }, now, 24)!.why).toMatch(/stop_loss -\$1.00/);
    expect(reentryBan({ closedAt: new Date(now - 25 * H), pnlUsd: -1, exitReason: 'stop_loss' }, now, 24)).toBeNull();
    expect(reentryBan({ closedAt: new Date(now - H), pnlUsd: 0.4, exitReason: 'trailing_stop' }, now, 24)).toBeNull();
    expect(reentryBan({ closedAt: new Date(now - H), pnlUsd: 0, exitReason: 'stuck_written_off' }, now, 24)).not.toBeNull();
    expect(reentryBan(null, now, 24)).toBeNull();
    expect(reentryBan({ closedAt: new Date(now - H), pnlUsd: -1, exitReason: 'stop_loss' }, now, 0)).toBeNull();
  });
  it('env: default 24, 0 disables, capped at a week', () => {
    expect(reentryCooldownHours({})).toBe(24);
    expect(reentryCooldownHours({ REENTRY_COOLDOWN_HOURS: '0' })).toBe(0);
    expect(reentryCooldownHours({ REENTRY_COOLDOWN_HOURS: '999' })).toBe(168);
    expect(reentryCooldownHours({ REENTRY_COOLDOWN_HOURS: 'x' })).toBe(24);
  });
});

describe('holder-sell exit decision', () => {
  const base: HolderSnap = { at: 0, supply: 1_000_000, holders: { A: 50_000, B: 20_000, C: 500 }, creator: 'D', creatorAmt: 30_000 };
  const cur = (o: Partial<HolderSnap>): HolderSnap => ({ ...base, at: 1, ...o, holders: { ...base.holders, ...(o.holders ?? {}) } });
  it('creator selling >= 20% of its bag -> dev_exit', () => {
    expect(holderSellDecision(base, cur({ creatorAmt: 20_000 }))).toMatchObject({ reason: 'dev_exit', wallet: 'D', soldFrac: 0.333 });
    expect(holderSellDecision(base, cur({ creatorAmt: 27_000 }))).toBeNull(); // 10%
  });
  it('top holder selling >= 20% (and >= 0.1% of supply), or >= 1% of supply -> holder_exit', () => {
    expect(holderSellDecision(base, cur({ holders: { B: 15_000 } }))).toMatchObject({ reason: 'holder_exit', wallet: 'B' });
    expect(holderSellDecision(base, cur({ holders: { A: 39_000 } }))).toMatchObject({ wallet: 'A', soldSupplyPct: 1.1 }); // 22% and 1.1%
    expect(holderSellDecision(base, cur({ holders: { C: 0 } }))).toBeNull(); // dust: 100% of a 0.05% bag
    expect(holderSellDecision(base, cur({ holders: { A: 60_000 } }))).toBeNull(); // bought more
  });
  it('unknown current balance is skipped, never treated as a sell', () => {
    const c = cur({}); delete (c.holders as Record<string, number>).A; c.creatorAmt = null;
    expect(holderSellDecision(base, c)).toBeNull();
  });
});

describe('holder watch polling (fake RPC)', () => {
  let dir: string;
  const [a, b, me] = [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()];
  const pool = PublicKey.findProgramAddressSync([Buffer.from('pool')], new PublicKey('11111111111111111111111111111111'))[0].toBase58();
  let bal: Record<string, number>;
  const rpc = async <T,>(method: string): Promise<T> => {
    const owners = [pool, a, b, me];
    if (method === 'getTokenLargestAccounts') return { value: owners.map((o, i) => ({ address: `acct${i}`, uiAmount: bal[o] })) } as T;
    if (method === 'getTokenSupply') return { value: { uiAmount: 1_000_000 } } as T;
    if (method === 'getMultipleAccounts') return { value: owners.map((o) => ({ data: { parsed: { info: { owner: o } } } })) } as T;
    if (method === 'getTokenAccountsByOwner') return { value: [] } as T;
    throw new Error(method);
  };
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-')); process.env.HOLDER_BASELINE_STORE = path.join(dir, 'b.json'); _resetHolderStore(); bal = { [pool]: 500_000, [a]: 60_000, [b]: 30_000, [me]: 1_000 }; });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.HOLDER_BASELINE_STORE; _resetHolderStore(); });
  it('baseline first (persisted, pool + own wallet excluded), then flags a holder dump; throttled', async () => {
    const logs: string[] = [];
    const pos = { id: 'p1', mint: 'M', creator: null };
    await pollHolders(pos, me, (m) => logs.push(m), 0, rpc);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'b.json'), 'utf8')).p1;
    expect(Object.keys(stored.holders).sort()).toEqual([a, b].sort());
    expect(logs[0]).toMatch(/baseline/);
    expect(pollHolders(pos, me, () => undefined, 60_000, rpc)).toBeNull(); // < 120 s
    bal[a] = 40_000; // sold 33% = 2% of supply
    await pollHolders(pos, me, () => undefined, 130_000, rpc);
    expect(takeHolderExit('p1')).toMatchObject({ reason: 'holder_exit', wallet: a });
    expect(takeHolderExit('p1')).toBeNull();
  });
  it('an RPC failure skips the round without throwing', async () => {
    await expect(pollHolders({ id: 'p2', mint: 'M', creator: null }, me, () => undefined, 0, async () => { throw new Error('429'); })).resolves.toBeUndefined();
    expect(takeHolderExit('p2')).toBeNull();
  });
});

describe('txAccountKeys (v0 with lookup tables)', () => {
  const k1 = Keypair.generate().publicKey, k2 = Keypair.generate().publicKey;
  const msg = { getAccountKeys: (arg?: { accountKeysFromLookups?: { writable: PublicKey[]; readonly: PublicKey[] } | null }) => {
    if (!arg?.accountKeysFromLookups) throw new Error('Failed to get account keys because address table lookups were not resolved');
    return { keySegments: () => [[k1], arg.accountKeysFromLookups!.writable, arg.accountKeysFromLookups!.readonly] };
  } };
  it('includes looked-up keys instead of throwing', () => {
    expect(txAccountKeys({ transaction: { message: msg }, meta: { loadedAddresses: { writable: [k2], readonly: [] } } })).toEqual([k1.toBase58(), k2.toBase58()]);
    expect(txAccountKeys({ transaction: { message: msg }, meta: null })).toEqual([]);
  });
});
