import type { Prisma } from '@prisma/client';

/** Minimum number of distinct people behind any community figure (counts and P&L alike). */
export const COMMUNITY_MIN_PEOPLE = 5;

/** Members only count toward community figures once their account is this old (slows sybil floor-filling, L-103a). */
export const COMMUNITY_MIN_MEMBER_AGE_DAYS = 7;

/**
 * The only paper positions community aggregates may read: simulated, not a lab preset account,
 * and owned by a member who has opted in to the community, is not banned (#103 scope) and whose
 * account is at least COMMUNITY_MIN_MEMBER_AGE_DAYS old.
 */
export function communityPaperScope(now: Date = new Date()) {
  const joinedBy = new Date(now.getTime() - COMMUNITY_MIN_MEMBER_AGE_DAYS * 86_400_000);
  return {
    simulated: true,
    account: { labPreset: null, user: { is: { banned: false, createdAt: { lte: joinedBy }, communityOptIn: { is: { optedIn: true } } } } },
  } satisfies Prisma.PositionWhereInput;
}

/** Distinct people from rows that carry the owning account's userId. */
export function distinctPeople(rows: Array<{ account: { userId: string | null } }>): number {
  return new Set(rows.map((r) => r.account.userId).filter((id): id is string => Boolean(id))).size;
}

/** A count is only published when it covers at least five people; otherwise null (hidden, not 0). */
export function flooredCount(n: number, min = COMMUNITY_MIN_PEOPLE): number | null {
  return Number.isFinite(n) && n >= min ? n : null;
}
