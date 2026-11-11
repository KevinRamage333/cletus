import { describe, it, expect, vi } from 'vitest';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { closeEmptyTokenAccounts, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@/lib/rent-reclaim';
import { exitDecision } from '@/lib/exits';

const owner = Keypair.generate();
const MINT = Keypair.generate().publicKey.toBase58();
const acct = (amount: string, program = TOKEN_PROGRAM_ID) => ({
  pubkey: Keypair.generate().publicKey,
  account: { owner: new PublicKey(program), data: { parsed: { info: { tokenAmount: { amount } } } } },
});
function conn(accounts: ReturnType<typeof acct>[]) {
  const sent: Buffer[] = [];
  return {
    sent,
    getParsedTokenAccountsByOwner: vi.fn(async () => ({ context: { slot: 1 }, value: accounts })),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 })),
    sendRawTransaction: vi.fn(async (raw: Buffer) => { sent.push(Buffer.from(raw)); return 'sig123'; }),
    confirmTransaction: vi.fn(async () => ({ context: { slot: 2 }, value: { err: null } })),
  };
}

describe('rent reclaim after a full live exit', () => {
  it('closes every empty token account for the mint with CloseAccount, rent to the wallet', async () => {
    const accs = [acct('0'), acct('0', TOKEN_2022_PROGRAM_ID)];
    const c = conn(accs);
    const r = await closeEmptyTokenAccounts(c as never, owner, MINT);
    expect(r).toEqual({ closed: 2, skipped: null, signature: 'sig123' });
    const tx = Transaction.from(c.sent[0]);
    expect(tx.instructions).toHaveLength(2);
    tx.instructions.forEach((ix, k) => {
      expect([...ix.data]).toEqual([9]);
      expect(ix.programId.equals(accs[k].account.owner)).toBe(true);
      expect(ix.keys[0].pubkey.equals(accs[k].pubkey)).toBe(true);
      expect(ix.keys[1].pubkey.equals(owner.publicKey)).toBe(true); // destination = trading wallet
      expect(ix.keys[2]).toMatchObject({ isSigner: true });
    });
    expect(tx.verifySignatures()).toBe(true);
  });

  it('skips the whole mint if any account still holds tokens', async () => {
    const c = conn([acct('0'), acct('12345')]);
    expect(await closeEmptyTokenAccounts(c as never, owner, MINT)).toMatchObject({ closed: 0, skipped: 'balance remains' });
    expect(c.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('no account / wrapped SOL / unknown program: nothing sent', async () => {
    expect((await closeEmptyTokenAccounts(conn([]) as never, owner, MINT)).skipped).toBe('no token account');
    expect((await closeEmptyTokenAccounts(conn([acct('0')]) as never, owner, 'So11111111111111111111111111111111111111112')).skipped).toBe('wrapped SOL');
    const c = conn([acct('0', Keypair.generate().publicKey.toBase58())]);
    expect((await closeEmptyTokenAccounts(c as never, owner, MINT)).skipped).toBe('unknown token program');
    expect(c.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe('owner exits: trailing arms at +10%, trails 8%; stale exit after 120 min; SL 5 / TP 20 unchanged', () => {
  const p = { stopLossPct: 5, takeProfitPct: 20, breakEvenTriggerPct: 5, enableTrailingStop: true, trailingStopPct: 8, trailingArmPct: 10, holdTimeMinutes: 10080, stalePositionMinutes: 120, staleBandPct: 3 };
  const now = new Date('2026-11-11T20:00:00Z');
  const pos = (peak: number, ageMin = 30) => ({ entryPrice: 1, highestPrice: peak, openedAt: new Date(now.getTime() - ageMin * 60_000) });
  it('peak +8% does not arm the trail', () => expect(exitDecision(pos(1.08), 1.03, p, now)).toBeNull());
  it('peak +15% then -8% from peak exits on the trail', () => expect(exitDecision(pos(1.15), 1.05, p, now)).toBe('trailing_stop'));
  it('hard SL and full TP unchanged', () => { expect(exitDecision(pos(1), 0.95, p, now)).toBe('stop_loss'); expect(exitDecision(pos(1.1), 1.21, p, now)).toBe('take_profit'); });
  it('dead coin exits after 120 min inside ±3%, not before', () => {
    expect(exitDecision(pos(1.02, 119), 1.01, p, now)).toBeNull();
    expect(exitDecision(pos(1.02, 121), 1.01, p, now)).toBe('stale_exit');
    expect(exitDecision(pos(1.04, 121), 1.035, p, now)).toBeNull();
  });
  it('no trailingArmPct keeps the old arm-at-break-even behaviour', () => expect(exitDecision(pos(1.08), 1.03, { ...p, trailingArmPct: 0, trailingStopPct: 3 }, now)).toBe('trailing_stop'));
});
