import type { Position, Prisma } from '@prisma/client';
import { prisma } from './db';

/** Settle a position and its account together if the fill still matches the open snapshot. */
export function settlePositionExit(
  position: Pick<Position, 'id' | 'accountId' | 'partialsTaken' | 'simulated'>,
  fill: Prisma.PositionUpdateManyMutationInput,
  balance: Prisma.AccountUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.position.updateMany({
      where: {
        id: position.id,
        accountId: position.accountId,
        simulated: position.simulated,
        status: 'open',
        partialsTaken: position.partialsTaken,
      },
      data: fill,
    });
    if (claim.count === 0) return null;
    return tx.account.update({ where: { id: position.accountId }, data: balance });
  });
}

/** Keep the paper-only entry point for callers that never settle live positions. */
export function settlePaperExit(
  position: Pick<Position, 'id' | 'accountId' | 'partialsTaken'>,
  fill: Prisma.PositionUpdateManyMutationInput,
  balance: Prisma.AccountUpdateInput,
) {
  return settlePositionExit({ ...position, simulated: true }, fill, balance);
}
