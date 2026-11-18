/**
 * Fund-movement inventory (Cletus, 2026-11-17): besides trading swaps, the bot's only fund-moving command is a profit
 * withdrawal to the user's own wallet. This test pins every code path that can build a transfer, so a new one can't be
 * added without review, and checks each path's destination guard.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { checkSimWithdraw } from '@/lib/sim-withdraw';
import { decide, newRequest } from '@/lib/owner-withdraw-queue';
import { JITO_TIP_ACCOUNTS, pickTipAccount } from '@/lib/private-route';

const root = path.resolve(__dirname, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? (f === 'node_modules' ? [] : walk(p)) : /\.(ts|tsx|mts|mjs)$/.test(f) ? [p] : []; });
const TRANSFER = /SystemProgram\.transfer|createTransfer(Checked)?Instruction|sendRawTransaction|sendAndConfirmTransaction|writeContract|useSendTransaction|sendTransactionAsync/;

describe('every fund-moving code path is known', () => {
  it('only these files can build or send a transfer', () => {
    const hits = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts'))]
      .filter((f) => TRANSFER.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f)).sort();
    expect(hits).toEqual([
      'src/lib/owner-withdraw-exec.ts', // owner withdrawal: OWNER_WITHDRAW_ALLOWLIST + daily cap, box worker only
      'src/lib/private-route.ts',       // Jito tip that rides with a trading swap (fixed tip accounts)
      'src/lib/profit-sweep.ts',        // profit sweep: only to the confirmed PAYOUT_WALLET
      'src/lib/rent-reclaim.ts',        // closes empty token accounts; rent returns to the trading wallet itself
      'src/lib/withdraw-server.ts',     // owner/admin withdraw preview+confirm (WITHDRAW_LIVE_ENABLED, live mode)
    ]);
  });
});

describe('withdraw destinations', () => {
  const me = '4pRMrg37MfkKgoawxFpjECLC5LTGbvc22yKFCh9mPPe3';
  const other = 'GdDBJt1nCibTENMKnGRPoNkjaCskTXwrdF1x1UHgY7Hq';
  it('a user withdrawal can only go to the user\'s own registered Solana wallet', () => {
    expect(checkSimWithdraw({ chain: 'solana', to: me, amountUsd: 1 }, { walletPublicKey: me }, 10).ok).toBe(true);
    expect(checkSimWithdraw({ chain: 'solana', to: other, amountUsd: 1 }, { walletPublicKey: me }, 10)).toEqual({ ok: false, error: 'You can only withdraw to your own connected wallet' });
    expect(checkSimWithdraw({ chain: 'solana', to: me, amountUsd: 1 }, { walletPublicKey: null }, 10).ok).toBe(false);
  });
  it('the owner remote withdrawal refuses any address that is not on the owner allowlist', () => {
    const r = newRequest({ wallet: 'main', to: other, amountSol: 0.1, by: me });
    if (!r.ok) throw new Error(r.error);
    expect(decide(r.request, { enabled: true, allowlist: [me], capLamports: 1e12, ledger: [] })).toMatchObject({ execute: false, reason: 'destination is not on the owner allowlist' });
    expect(decide(r.request, { enabled: true, allowlist: [other], capLamports: 1e12, ledger: [] })).toEqual({ execute: true });
  });
  it('profit sweep sends only to the configured PAYOUT_WALLET (source guard)', () => {
    const src = readFileSync(path.join(root, 'src/lib/profit-sweep.ts'), 'utf8');
    expect(src).toMatch(/dest\.address !== planned\) throw new Error\('Destination is not the configured PAYOUT_WALLET'\)/);
  });
  it('Jito tips only go to the fixed tip accounts', () => {
    for (let i = 0; i < 50; i++) expect(JITO_TIP_ACCOUNTS).toContain(pickTipAccount());
  });
});
