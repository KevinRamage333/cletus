/** Server glue for owner withdrawals (box worker only). See withdraw.ts for the rules. */
import { SystemProgram, Transaction, PublicKey } from '@solana/web3.js';
import { prisma } from './db';
import { HttpError } from './auth';
import { appContext } from './app-api';
import { getConfig } from './config';
import { log } from './logger';
import { isDemo } from './demo';
import { getOperatorWalletAddress as getOperatorPublicKey } from './wallet';
import { closePosition, ensureOperatorAccount, mem } from './engine';
import { LAMPORTS_PER_SOL, reserveLamports, type WithdrawDeps } from './withdraw';

export const liveWithdrawEnabled = () => process.env.WITHDRAW_LIVE_ENABLED === 'true';
export const ownerSecret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new HttpError(503, 'SESSION_SECRET is not configured');
  return `withdraw:${s}`;
};

/** Who may withdraw: an admin, on the worker that holds the operator key, outside demo mode. */
export function availability(isAdmin: boolean): { available: true; reason: null; operator: string } | { available: false; reason: string } {
  if (isDemo()) return { available: false, reason: 'Available when the trading worker is online' };
  const op = getOperatorPublicKey();
  if (!op) return { available: false, reason: 'Available when the trading worker is online (no trading wallet key on this server)' };
  if (!isAdmin) return { available: false, reason: 'Owner only' };
  return { available: true, reason: null, operator: op };
}

export async function ownerContext() {
  const ctx = await appContext();
  const av = availability(ctx.u.isAdmin);
  if (!av.available) throw new HttpError(ctx.u.isAdmin ? 503 : 403, av.reason);
  return { ...ctx, operator: av.operator };
}

export async function balanceLamports(address: string): Promise<number> {
  const { connection } = await import('./executor');
  return connection(getConfig()).getBalance(new PublicKey(address));
}

export function deps(uid: string, operator: string): WithdrawDeps {
  return {
    liveEnabled: liveWithdrawEnabled(),
    ownAddress: operator,
    getBalanceLamports: () => balanceLamports(operator),
    closeAllPositions: async () => {
      const op = await ensureOperatorAccount();
      const open = await prisma.position.findMany({ where: { accountId: op.id, status: 'open' } });
      for (const p of open) await closePosition(p.id, mem.prices.get(p.mint) ?? p.lastPrice, 'owner_withdraw');
      const still = await prisma.position.count({ where: { accountId: op.id, status: 'open' } });
      return open.length - still;
    },
    sendTransfer: async (to, lamports) => {
      const { connection } = await import('./executor');
      const { loadOperatorKeypair } = await import('./wallet');
      const kp = loadOperatorKeypair();
      const conn = connection(getConfig());
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight })
        .add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(to), lamports }));
      tx.sign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      if (conf.value.err) throw new Error(`transaction failed: ${JSON.stringify(conf.value.err)}`);
      return sig;
    },
    log: (level, msg) => log(level, msg, null),
    record: async (r) => { await prisma.withdrawal.create({ data: { userId: uid, toAddress: r.to.slice(0, 64), lamports: String(r.lamports), mode: r.mode, status: r.status, signature: r.signature ?? null, closedPositions: r.closedPositions, error: r.error ?? null } }); },
  };
}

export { reserveLamports, LAMPORTS_PER_SOL };
