import { createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { HttpError } from './auth';
import { cleanText, looksSecret } from './community';
import { COMMUNITY_FEED_HREF, threadHref } from './community-paths';

export { COMMUNITY_FEED_HREF, threadHref };

export type PostStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ReviewAction = 'APPROVED' | 'REJECTED';

export type PostRecord = {
  id: string;
  userId: string;
  parentId: string | null;
  body: string;
  status: PostStatus;
  moderationReason: string | null;
  createdAt: Date;
  replyCount?: number;
  reportCount?: number;
  flagged?: boolean;
};

export type FeedPost = {
  id: string;
  body: string;
  createdAt: string;
  authorLabel: string;
  parentId: string | null;
  replyCount: number;
  mine?: boolean;
  status?: PostStatus;
  moderationReason?: string | null;
  flagged?: boolean;
};

export type StoredEvent = { postId: string; moderatorUserId: string; action: ReviewAction; reason: string | null; createdAt: Date };

/** Repository surface used by posting and moderation. Prisma and tests both implement it. */
export interface CommunityTx {
  lockOptIn(userId: string): Promise<boolean>;
  recentPosts(userId: string, since: Date): Promise<Array<{ body: string; createdAt: Date }>>;
  lockPost(id: string): Promise<PostRecord | null>;
  insertPost(input: { userId: string; body: string; parentId: string | null }): Promise<PostRecord>;
  writeDecision(input: { postId: string; moderatorId: string; action: ReviewAction; reason: string | null; at: Date }): Promise<void>;
  addReport(input: { postId: string; reporterUserId: string; reason: string }): Promise<'created' | 'duplicate'>;
  countReports(postId: string): Promise<number>;
  flagPost(postId: string): Promise<void>;
}

export const COLLECTIVE_PRIVACY_THRESHOLD = 5;
export const POST_LIMIT = 6;
export const POST_WINDOW_MS = 10 * 60 * 1000;
export const POST_GAP_MS = 3000;
export const REPORT_FLAG_THRESHOLD = 3;

/** `contributors` is the number of distinct people whose closed trades are in the aggregate, not the opt-in count. */
export function collectiveFiguresVisible(contributors: number): boolean {
  return Number.isFinite(contributors) && contributors >= COLLECTIVE_PRIVACY_THRESHOLD;
}

/** Server secret for anonymous labels. COMMUNITY_ANON_SALT, else SESSION_SECRET (always set where sessions work). */
export function anonLabelKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = String(env.COMMUNITY_ANON_SALT || env.SESSION_SECRET || '');
  if (key.length < 16) throw new HttpError(503, 'Community labels are not configured on this server.');
  return key;
}

/** Keyed (HMAC-SHA256) so a known user id cannot be checked against a label; 8 hex chars keeps collisions rare. */
export function anonymousAuthorLabel(userId: string, key = anonLabelKey()): string {
  const hex = createHmac('sha256', key).update(`cletus-community-anon-v2:${userId}`).digest('hex').slice(0, 8);
  return `Member ${hex}`;
}

export function moderatorIdsFrom(env: NodeJS.ProcessEnv = process.env): string[] {
  return String(env.CLETUS_COMMUNITY_MODERATOR_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function isCommunityModerator(user: { id: string; isAdmin: boolean }, ids = moderatorIdsFrom()): boolean {
  return user.isAdmin || ids.includes(user.id);
}

export function assertCommunityModerator(user: { id: string; isAdmin: boolean }, ids = moderatorIdsFrom()): void {
  if (!isCommunityModerator(user, ids)) throw new HttpError(403, 'Moderator access is not configured for this account.');
}

export function sanitizePostBody(value: unknown): string {
  const body = String(value ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
  if (!body) throw new HttpError(400, 'Write a message before posting.');
  if (body.length > 500) throw new HttpError(400, 'Community posts are limited to 500 characters.');
  if (looksSecret(body)) throw new HttpError(400, 'This message appears to contain a private key or recovery phrase. Remove it before posting.');
  const urls = body.match(/https?:\/\//gi);
  if (urls && urls.length > 2) throw new HttpError(400, 'Posts can include at most two links.');
  if (/(.)\1{19,}/u.test(body)) throw new HttpError(400, 'That post looks like spam.');
  return body;
}

/** Public and author views never include account ids, emails, or email-derived names. */
export function toFeedPost(row: PostRecord, viewerId: string | null): FeedPost | null {
  const mine = Boolean(viewerId && viewerId === row.userId);
  if (row.status !== 'APPROVED' && !mine) return null;
  const post: FeedPost = {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    authorLabel: mine ? 'You' : anonymousAuthorLabel(row.userId),
    parentId: row.parentId,
    replyCount: row.replyCount ?? 0,
  };
  if (mine) {
    post.mine = true;
    post.status = row.status;
    post.moderationReason = row.moderationReason;
  }
  return post;
}

export function toQueuePost(row: PostRecord): { id: string; body: string; createdAt: string; authorLabel: 'Private member'; reportCount: number; flagged: boolean } {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    authorLabel: 'Private member',
    reportCount: row.reportCount ?? 0,
    flagged: Boolean(row.flagged),
  };
}

export async function commitPost(tx: CommunityTx, userId: string, body: string, parentId: string | null, now = new Date()): Promise<PostRecord> {
  const optedIn = await tx.lockOptIn(userId);
  if (!optedIn) throw new HttpError(403, 'Opt in to the community before posting.');
  const since = new Date(now.getTime() - POST_WINDOW_MS);
  const recent = await tx.recentPosts(userId, since);
  const latest = recent[0];
  if (latest && now.getTime() - latest.createdAt.getTime() < POST_GAP_MS) throw new HttpError(429, 'one message every 3 seconds');
  if (recent.length >= POST_LIMIT) throw new HttpError(429, 'posting limit reached; try again later');
  if (recent.some((row) => row.body === body)) throw new HttpError(400, 'That post was already submitted.');
  if (parentId) {
    const parent = await tx.lockPost(parentId);
    if (!parent || parent.status !== 'APPROVED' || parent.parentId) throw new HttpError(400, 'Replies have to be on an approved post.');
  }
  return tx.insertPost({ userId, body, parentId });
}

/** Status change and the append-only event are one repository write, inside the caller's transaction. */
export async function commitReview(tx: CommunityTx, moderatorId: string, postId: string, action: ReviewAction, reason: string | null, now = new Date()): Promise<void> {
  const post = await tx.lockPost(postId);
  if (!post) throw new HttpError(404, 'Post not found.');
  if (post.status !== 'PENDING') throw new HttpError(409, 'This post has already been reviewed.');
  if (post.userId === moderatorId) throw new HttpError(403, 'Moderators cannot review their own posts.');
  await tx.writeDecision({ postId, moderatorId, action, reason, at: now });
}

function asStatus(value: string): PostStatus {
  if (value === 'APPROVED' || value === 'REJECTED' || value === 'PENDING') return value;
  return 'PENDING';
}

function prismaTx(tx: Prisma.TransactionClient): CommunityTx {
  return {
    async lockOptIn(userId) {
      const rows = await tx.$queryRaw<Array<{ optedIn: boolean }>>`
        SELECT "optedIn" FROM "app"."CommunityOptIn" WHERE "userId" = ${userId} FOR UPDATE
      `;
      return rows[0]?.optedIn === true;
    },
    async recentPosts(userId, since) {
      const rows = await tx.communityPost.findMany({
        where: { userId, createdAt: { gte: since } },
        select: { body: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      return rows;
    },
    async lockPost(id) {
      const rows = await tx.$queryRaw<Array<{ id: string; userId: string; parentId: string | null; body: string; status: string; moderationReason: string | null; createdAt: Date }>>`
        SELECT "id", "userId", "parentId", "body", "status", "moderationReason", "createdAt"
        FROM "app"."CommunityPost" WHERE "id" = ${id} FOR UPDATE
      `;
      const row = rows[0];
      if (!row) return null;
      return { ...row, status: asStatus(row.status), createdAt: new Date(row.createdAt) };
    },
    async insertPost(input) {
      const created = await tx.communityPost.create({
        data: { userId: input.userId, body: input.body, parentId: input.parentId, status: 'PENDING' },
      });
      return { id: created.id, userId: created.userId, parentId: created.parentId, body: created.body, status: 'PENDING', moderationReason: null, createdAt: created.createdAt };
    },
    async writeDecision(input) {
      await tx.communityPost.update({
        where: { id: input.postId },
        data: { status: input.action, moderationReason: input.reason, moderatedAt: input.at, moderatedBy: input.moderatorId },
      });
      await tx.communityModerationEvent.create({
        data: { postId: input.postId, moderatorUserId: input.moderatorId, action: input.action, reason: input.reason, createdAt: input.at },
      });
    },
    async addReport(input) {
      try {
        await tx.communityReport.create({ data: input });
        return 'created';
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') return 'duplicate';
        throw error;
      }
    },
    async countReports(postId) {
      return tx.communityReport.count({ where: { postId } });
    },
    async flagPost(postId) {
      await tx.communityPost.update({ where: { id: postId }, data: { flagged: true } });
    },
  };
}

async function requirePoster(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, banned: true, isAdmin: true } });
  if (!user) throw new HttpError(401, 'not signed in');
  if (user.banned) throw new HttpError(403, 'you are muted in Community');
  return user;
}

export async function submitCommunityPost(userId: string, raw: unknown, parentId?: string | null) {
  await requirePoster(userId);
  const body = sanitizePostBody(raw);
  const created = await prisma.$transaction((tx) => commitPost(prismaTx(tx), userId, body, parentId ?? null));
  return { id: created.id, status: 'PENDING' as const, createdAt: created.createdAt.toISOString(), body: created.body, message: 'Your post was received and is awaiting moderation.' };
}

export async function setCommunityOptIn(userId: string, enabled: boolean) {
  if (typeof enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false');
  const row = await prisma.communityOptIn.upsert({
    where: { userId },
    create: { userId, optedIn: enabled },
    update: { optedIn: enabled },
  });
  return { optedIn: row.optedIn, updatedAt: row.updatedAt.toISOString() };
}

/** replyCount only counts APPROVED replies, so pending or rejected replies are not revealed. */
const COUNTS = { _count: { select: { replies: { where: { status: 'APPROVED' } }, reports: true } } } satisfies Prisma.CommunityPostInclude;

async function withCounts(rows: Array<{ id: string; userId: string; parentId: string | null; body: string; status: string; moderationReason: string | null; createdAt: Date; flagged: boolean; _count?: { replies: number; reports: number } }>): Promise<PostRecord[]> {
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    parentId: row.parentId,
    body: row.body,
    status: asStatus(row.status),
    moderationReason: row.moderationReason,
    createdAt: row.createdAt,
    flagged: row.flagged,
    replyCount: row._count?.replies ?? 0,
    reportCount: row._count?.reports ?? 0,
  }));
}

export async function loadCommunityFeed(user: { id: string; isAdmin: boolean; banned: boolean }) {
  const [opt, roots, mine] = await Promise.all([
    prisma.communityOptIn.findUnique({ where: { userId: user.id }, select: { optedIn: true } }),
    prisma.communityPost.findMany({
      where: { status: 'APPROVED', parentId: null },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: COUNTS,
    }),
    prisma.communityPost.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: COUNTS,
    }),
  ]);
  const approved = (await withCounts(roots)).map((row) => toFeedPost(row, user.id)).filter((row): row is FeedPost => Boolean(row));
  const own = (await withCounts(mine)).map((row) => toFeedPost(row, user.id)).filter((row): row is FeedPost => Boolean(row));
  return {
    posts: approved,
    mine: own,
    me: { optedIn: opt?.optedIn === true, isModerator: isCommunityModerator(user), banned: user.banned },
    refreshedAt: new Date().toISOString(),
  };
}

export async function loadThread(user: { id: string }, postId: string) {
  const rootRow = await prisma.communityPost.findUnique({ where: { id: postId }, include: COUNTS });
  if (!rootRow || rootRow.parentId) throw new HttpError(404, 'Thread not found.');
  const root = toFeedPost((await withCounts([rootRow]))[0], user.id);
  if (!root) throw new HttpError(404, 'Thread not found.');
  const replyRows = await prisma.communityPost.findMany({
    where: { parentId: postId, OR: [{ status: 'APPROVED' }, { userId: user.id }] },
    orderBy: { createdAt: 'asc' },
    include: COUNTS,
  });
  const replies = (await withCounts(replyRows)).map((row) => toFeedPost(row, user.id)).filter((row): row is FeedPost => Boolean(row));
  const [opt, account] = await Promise.all([
    prisma.communityOptIn.findUnique({ where: { userId: user.id }, select: { optedIn: true } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { banned: true, isAdmin: true } }),
  ]);
  return {
    root,
    replies,
    refreshedAt: new Date().toISOString(),
    me: { optedIn: opt?.optedIn === true, isModerator: isCommunityModerator({ id: user.id, isAdmin: account?.isAdmin === true }), banned: account?.banned === true },
  };
}

export async function moderateCommunityPost(moderator: { id: string; isAdmin: boolean }, postId: string, action: ReviewAction, reason?: unknown) {
  assertCommunityModerator(moderator);
  if (action !== 'APPROVED' && action !== 'REJECTED') throw new HttpError(400, 'Action must be APPROVED or REJECTED.');
  const note = cleanText(reason, 300);
  if (action === 'REJECTED' && !note) throw new HttpError(400, 'A rejection reason is required.');
  const now = new Date();
  await prisma.$transaction((tx) => commitReview(prismaTx(tx), moderator.id, postId, action, note || null, now));
  return { postId, status: action, reviewedAt: now.toISOString() };
}

export async function listModerationQueue(moderator: { id: string; isAdmin: boolean }) {
  assertCommunityModerator(moderator);
  const rows = await prisma.communityPost.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: COUNTS,
  });
  return { posts: (await withCounts(rows)).map(toQueuePost) };
}

export async function reportCommunityPost(userId: string, postId: string, reason: unknown) {
  const user = await requirePoster(userId);
  const note = cleanText(reason, 300);
  if (!note) throw new HttpError(400, 'Say what is wrong with the post.');
  const post = await prisma.communityPost.findUnique({ where: { id: postId }, select: { id: true, userId: true, status: true } });
  // Only approved posts are visible to members, so only approved posts can be reported.
  if (!post || post.status !== 'APPROVED') throw new HttpError(404, 'Post not found.');
  if (post.userId === user.id) throw new HttpError(400, 'You cannot report your own post.');
  const result = await prisma.$transaction(async (tx) => {
    const adapter = prismaTx(tx);
    const created = await adapter.addReport({ postId, reporterUserId: userId, reason: note });
    const count = await adapter.countReports(postId);
    if (count >= REPORT_FLAG_THRESHOLD) await adapter.flagPost(postId);
    return { created, count };
  });
  if (result.created === 'duplicate') throw new HttpError(409, 'You already reported this post.');
  return { ok: true, flagged: result.count >= REPORT_FLAG_THRESHOLD };
}
