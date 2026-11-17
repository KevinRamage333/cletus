import type { Position, Prisma } from '@prisma/client';
import { prisma } from './db';

/** Apply a paper exit only if the position still matches the fill's snapshot. */
export function settlePaperExit(
  position: Pick<Position, 'id' | 'accountId' | 'partialsTaken'>,
  fill: Prisma.PositionUpdateManyMutationInput,
  balance: Prisma.AccountUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.position.updateMany({
      where: {
        id: position.id,
        accountId: position.accountId,
        simulated: true,
        status: 'open',
        partialsTaken: position.partialsTaken,
      },
      data: fill,
    });
    if (claim.count === 0) return null;
    return tx.account.update({ where: { id: position.accountId }, data: balance });
  });
}
