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
    account: { labPreset: null, user: { is: { banned: false, createdAt: { lte: joinedBy }, communityOptIn: { is: { optedIn: true, optedInAt: { not: null } } } } } },
  } satisfies Prisma.PositionWhereInput;
}

/** Account fields the P&L routes select so each trade can be checked against its member's eligibility. */
export const ELIGIBILITY_SELECT = { userId: true, user: { select: { createdAt: true, communityOptIn: { select: { optedInAt: true } } } } } as const;

/**
 * When a member's trades start counting toward community P&L: the later of account age + COMMUNITY_MIN_MEMBER_AGE_DAYS
 * and the opt-in time. Null when there is no opt-in time (never counts). Trades closed earlier are ignored, so a
 * member becoming eligible never rewrites already published days.
 */
export function memberEligibleFrom(createdAt: Date | null | undefined, optedInAt: Date | null | undefined): Date | null {
  if (!createdAt || !optedInAt) return null;
  return new Date(Math.max(createdAt.getTime() + COMMUNITY_MIN_MEMBER_AGE_DAYS * 86_400_000, optedInAt.getTime()));
}

/** Closed positions (selected with ELIGIBILITY_SELECT) -> rows for publishedCommunityPnl, each carrying its member's eligibility. */
export function pnlRows(rows: Array<{ pnlUsd: number | null; accountId: string; closedAt: Date | null; account: { user: { createdAt: Date; communityOptIn: { optedInAt: Date | null } | null } | null } }>) {
  return rows.map((r) => ({
    pnlUsd: r.pnlUsd, accountId: r.accountId, closedAt: r.closedAt,
    eligibleFrom: memberEligibleFrom(r.account.user?.createdAt, r.account.user?.communityOptIn?.optedInAt),
  }));
}

/** Distinct people from rows that carry the owning account's userId. */
export function distinctPeople(rows: Array<{ account: { userId: string | null } }>): number {
  return new Set(rows.map((r) => r.account.userId).filter((id): id is string => Boolean(id))).size;
}

/** A count is only published when it covers at least five people; otherwise null (hidden, not 0). */
export function flooredCount(n: number, min = COMMUNITY_MIN_PEOPLE): number | null {
  return Number.isFinite(n) && n >= min ? n : null;
}
