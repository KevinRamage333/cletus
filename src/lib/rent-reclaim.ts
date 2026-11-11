/**
 * Reclaim SPL token-account rent (~0.002 SOL ≈ $0.30-0.45 per coin) after a full live exit by closing the
 * wallet's now-empty token account(s) for that mint. Lamports go back to the trading wallet.
 *
 * Safety: only ever closes accounts owned by the trading wallet whose balance is exactly 0, and skips the
 * mint entirely if ANY of its accounts still holds tokens (a partial/failed sell must never be touched).
 * Never closes the wrapped-SOL account.
 */
import { PublicKey, Transaction, TransactionInstruction, type Connection, type Keypair } from '@solana/web3.js';

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const WSOL = 'So11111111111111111111111111111111111111112';
const CLOSE_ACCOUNT = 9; // SPL Token instruction index (same in Token-2022)

/** SPL Token CloseAccount: [account (w), destination (w), owner (signer)], data = [9]. */
export function closeAccountIx(account: PublicKey, destination: PublicKey, owner: PublicKey, programId: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([CLOSE_ACCOUNT]),
  });
}

export type ReclaimConn = Pick<Connection, 'getParsedTokenAccountsByOwner' | 'getLatestBlockhash' | 'sendRawTransaction' | 'confirmTransaction'>;
export interface ReclaimResult { closed: number; skipped: string | null; signature: string | null }

export async function closeEmptyTokenAccounts(conn: ReclaimConn, owner: Keypair, mint: string): Promise<ReclaimResult> {
  if (mint === WSOL) return { closed: 0, skipped: 'wrapped SOL', signature: null };
  const res = await conn.getParsedTokenAccountsByOwner(owner.publicKey, { mint: new PublicKey(mint) });
  if (!res.value.length) return { closed: 0, skipped: 'no token account', signature: null };
  const accts = res.value.map((a) => ({
    pubkey: a.pubkey,
    program: a.account.owner,
    amount: String((a.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed?.info?.tokenAmount?.amount ?? ''),
  }));
  if (accts.some((a) => a.amount !== '0')) return { closed: 0, skipped: 'balance remains', signature: null };
  const allowed = new Set([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);
  const closable = accts.filter((a) => allowed.has(a.program.toBase58()));
  if (!closable.length) return { closed: 0, skipped: 'unknown token program', signature: null };
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: owner.publicKey, blockhash, lastValidBlockHeight });
  for (const a of closable) tx.add(closeAccountIx(a.pubkey, owner.publicKey, owner.publicKey, a.program));
  tx.sign(owner);
  const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return { closed: closable.length, skipped: null, signature };
}
