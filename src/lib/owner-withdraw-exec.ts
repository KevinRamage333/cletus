/** Box-only wiring for the owner withdrawal queue (see owner-withdraw-queue.ts). */
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getConfig } from './config';
import { log } from './logger';
import { BASE_FEE_LAMPORTS, RENT_EXEMPT_MIN_LAMPORTS, reserveLamports } from './withdraw';
import {
  dailyCapLamports, ledgerPath, parseAllowlist, processRequests, readLedger, remoteWithdrawEnabled, writeLedger,
  type OwnerWithdrawRequest, type WithdrawWallet,
} from './owner-withdraw-queue';

async function sendSol(wallet: WithdrawWallet, to: string, lamports: number): Promise<string> {
  const { connection } = await import('./executor');
  const { loadOperatorKeypair, loadKolKeypair } = await import('./wallet');
  const kp = wallet === 'kol' ? loadKolKeypair() : loadOperatorKeypair();
  const conn = connection(getConfig());
  const bal = await conn.getBalance(kp.publicKey, 'confirmed');
  const keep = Math.max(reserveLamports(), RENT_EXEMPT_MIN_LAMPORTS);
  if (bal < lamports + BASE_FEE_LAMPORTS + keep) throw new Error(`insufficient balance: ${(bal / 1e9).toFixed(4)} SOL (keeps ${(keep / 1e9).toFixed(4)} SOL reserve)`);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight })
    .add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(to), lamports }));
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (conf.value.err) throw new Error(`transaction failed: ${JSON.stringify(conf.value.err)}`);
  return sig;
}

export async function processOwnerWithdrawals(reqs: OwnerWithdrawRequest[]): Promise<OwnerWithdrawRequest[]> {
  const path = ledgerPath();
  return processRequests(reqs, {
    enabled: remoteWithdrawEnabled(),
    allowlist: parseAllowlist(),
    capLamports: dailyCapLamports(),
    readLedger: () => readLedger(path),
    writeLedger: (rows) => writeLedger(rows, path),
    send: sendSol,
    log: (level, msg) => { void log(level, msg, null); },
  });
}
