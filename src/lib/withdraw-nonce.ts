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
  const id = createHash('sha256').update(`withdraw-confirm:${nonce}`).digest('hex');
  const consumed = await db.withdrawConfirmNonce.createMany({
    data: [{ id, uid, expiresAt: new Date(exp) }],
    skipDuplicates: true,
  });
  return consumed.count === 1;
}
