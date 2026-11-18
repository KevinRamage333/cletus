import { createHash } from 'node:crypto';
import { prisma } from './db';

type NonceDb = {
  withdrawConfirmNonce: {
    createMany: (args: {
      data: Array<{ id: string; uid: string; expiresAt: Date }>;
      skipDuplicates: boolean;
    }) => Promise<{ count: number }>;
  };
};

/** Persist a withdraw confirmation nonce (single-use across Vercel instances). */
export async function consumeWithdrawConfirmNonce(
  nonce: string,
  uid: string,
  exp: number,
  db: NonceDb = prisma,
): Promise<boolean> {
  return consumeNonce('withdraw-confirm', nonce, uid, exp, db);
}

/**
 * Single-use nonce for any signed challenge (withdraw confirm, onboarding SIWS, Cletus Verified).
 * Only a sha256 of purpose+nonce is stored. Returns false if it was already used.
 */
export async function consumeNonce(
  purpose: 'withdraw-confirm' | 'onboarding-siws' | 'verified-siws' | 'owner-siws',
  nonce: string,
  uid: string,
  exp: number,
  db: NonceDb = prisma,
): Promise<boolean> {
  if (!nonce) return false;
  const id = createHash('sha256').update(`${purpose}:${nonce}`).digest('hex');
  const consumed = await db.withdrawConfirmNonce.createMany({
    data: [{ id, uid, expiresAt: new Date(exp) }],
    skipDuplicates: true,
  });
  return consumed.count === 1;
}

const memNonces = new Map<string, number>();
/** Per-instance fallback when no database is configured (demo / file-backed listings). Same single-use semantics. */
export function consumeNonceInMemory(purpose: string, nonce: string, exp: number, now = Date.now()): boolean {
  if (!nonce) return false;
  for (const [k, e] of memNonces) if (e < now) memNonces.delete(k);
  const id = createHash('sha256').update(`${purpose}:${nonce}`).digest('hex');
  if (memNonces.has(id)) return false;
  memNonces.set(id, exp);
  return true;
}
