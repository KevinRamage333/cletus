import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';

const auth = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/auth', async (orig) => {
  const real = await orig<typeof import('@/lib/auth')>();
  return { ...real, requireOnboardedUser: vi.fn(async () => ({ id: auth.userId })) };
});

import { GET } from '@/app/api/community/collective-pnl/route';
import { GET as OVERVIEW } from '@/app/api/community/overview/route';
import { ERASED_POST_BODY, anonymiseCommunityMember } from '@/lib/community-erasure';
import { setCommunityOptIn } from '@/lib/community-feed';

const enabled = process.env.PAPER_SETTLEMENT_PG_TEST === '1';
const TAG = 'ci-community-privacy';
const DAY = 86_400_000;
/** Noon UTC yesterday: inside the last finished UTC day, which is the newest day the community figures publish. */
const yesterday = () => { const d = new Date(Date.now() - DAY); d.setUTCHours(12, 0, 0, 0); return d; };

async function member(n: number, opts: { optedIn?: boolean; banned?: boolean; closedPnl?: Array<number | null>; open?: number; mint?: string; joinedDaysAgo?: number; closedAt?: Date; optedInDaysAgo?: number } = {}) {
  // Members only count once their account is a week old (COMMUNITY_MIN_MEMBER_AGE_DAYS), so test members default to 30 days.
  const user = await prisma.user.create({ data: { email: `${TAG}-${n}-${Date.now()}@example.test`, banned: opts.banned ?? false, createdAt: new Date(Date.now() - (opts.joinedDaysAgo ?? 30) * 86_400_000) } });
  const optedIn = opts.optedIn ?? true;
  await prisma.communityOptIn.create({ data: { userId: user.id, optedIn, optedInAt: optedIn ? new Date(Date.now() - (opts.optedInDaysAgo ?? 20) * DAY) : null } });
  const account = await prisma.account.create({ data: { userId: user.id, name: `${TAG}-${n}`, startingBalance: 100, cashUsd: 100, peakEquity: 100 } });
  for (const pnl of opts.closedPnl ?? []) {
    await prisma.position.create({
      data: {
        accountId: account.id, mint: opts.mint ?? `mint-${n}`, symbol: 'TEST', status: 'closed', simulated: true,
        entryPrice: 1, sizeUsd: 10, tokenAmount: 10, highestPrice: 1, lastPrice: 1, compositeScore: 0, signals: '{}',
        closedAt: opts.closedAt ?? yesterday(), exitPrice: 1, pnlUsd: pnl,
      },
    });
  }
  for (let i = 0; i < (opts.open ?? 0); i++) {
    await prisma.position.create({
      data: {
        accountId: account.id, mint: opts.mint ?? `mint-${n}`, symbol: 'TEST', status: 'open', simulated: true,
        entryPrice: 1, sizeUsd: 10, tokenAmount: 10, highestPrice: 1, lastPrice: 1, compositeScore: 0, signals: '{}',
      },
    });
  }
  return user;
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.position.deleteMany({ where: { account: { userId: { in: ids } } } });
  await prisma.account.deleteMany({ where: { userId: { in: ids } } });
  await prisma.communityOptIn.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!enabled)('collective P&L privacy threshold with PostgreSQL', () => {
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

  it('stays suppressed with five opted in but only one person who traded', async () => {
    const viewer = await member(0, { closedPnl: [12.5] });
    for (let i = 1; i < 5; i++) await member(i);
    auth.userId = viewer.id;
    const body = await (await GET()).json();
    expect(body.suppressed).toBe(true);
    for (const key of ['netProfit', 'totalGains', 'totalLosses', 'winningTrades', 'losingTrades', 'activeUsers']) expect(body[key]).toBeNull();
  });

  it('does not count banned members toward the threshold', async () => {
    const viewer = await member(0, { closedPnl: [3] });
    for (let i = 1; i < 4; i++) await member(i, { closedPnl: [i] });
    await member(9, { banned: true, closedPnl: [100] });
    auth.userId = viewer.id;
    const body = await (await GET()).json();
    expect(body.suppressed).toBe(true);
    expect(body.netProfit).toBeNull();
  });

  it('shows figures from five distinct contributors only', async () => {
    const viewer = await member(0, { closedPnl: [10, -4] });
    for (let i = 1; i < 5; i++) await member(i, { closedPnl: [i] });
    await member(8, { optedIn: false, closedPnl: [500] });
    await member(9, { banned: true, closedPnl: [500] });
    auth.userId = viewer.id;
    const body = await (await GET()).json();
    expect(body.suppressed).toBe(false);
    // Only one person lost, so BOTH sides of the split stay hidden (net minus gains would reveal the loser).
    expect(body.totalGains).toBeNull();
    expect(body.totalLosses).toBeNull();
    expect(body.winningTrades).toBeNull();
    expect(body.losingTrades).toBeNull();
    expect(body.netProfit).toBe(16);
    expect(body.activeUsers).toBe(5);
  });
});

describe.skipIf(!enabled)('community overview privacy with PostgreSQL', () => {
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); });

  it('hides participant, open-position and token counts and P&L below five opted-in members', async () => {
    const viewer = await member(0, { closedPnl: [5], open: 1 });
    for (let i = 1; i < 4; i++) await member(i, { closedPnl: [i], open: 1 });
    // Non-opted-in and banned members must not lift the group over the floor.
    await member(8, { optedIn: false, closedPnl: [500], open: 1 });
    await member(9, { banned: true, closedPnl: [500], open: 1 });
    auth.userId = viewer.id;
    const body = await (await OVERVIEW()).json();
    expect(body.connected).toBe(true);
    expect(body.participants).toBeNull();
    expect(body.activeNow).toBeNull();
    expect(body.tokensPerNetwork).toBeNull();
    expect(body.collectivePnl.suppressed).toBe(true);
    expect(body.pnlSeries).toEqual([]);
    expect(body.mostTraded).toBeNull();
  });

  it('keeps P&L suppressed when five opted in but fewer than five closed a trade with known P&L', async () => {
    const viewer = await member(0, { closedPnl: [5], open: 1 });
    for (let i = 1; i < 5; i++) await member(i, { closedPnl: i < 3 ? [i] : [null], open: 1 });
    auth.userId = viewer.id;
    const body = await (await OVERVIEW()).json();
    expect(body.participants).toBe(5);
    expect(body.activeNow).toBe(5);
    expect(body.collectivePnl.suppressed).toBe(true);
    expect(body.mostTraded).toBeNull();
  });

  it('counts only opted-in, non-banned members once five contribute', async () => {
    const viewer = await member(0, { closedPnl: [10, -4], open: 1, mint: 'shared-mint' });
    for (let i = 1; i < 5; i++) await member(i, { closedPnl: [i], open: i < 3 ? 1 : 0, mint: 'shared-mint' });
    await member(8, { optedIn: false, closedPnl: [500], open: 3, mint: 'other-mint' });
    await member(9, { banned: true, closedPnl: [500], open: 3, mint: 'other-mint' });
    auth.userId = viewer.id;
    const body = await (await OVERVIEW()).json();
    expect(body.participants).toBe(5);
    expect(body.activeNow).toBeNull(); // only three opted-in members hold open positions
    expect(body.collectivePnl).toMatchObject({ suppressed: false, netUsd: 16, gainsUsd: null, winningTrades: null, lossesUsd: null, losingTrades: null, closedTrades: 6 });
    expect(body.tokensPerNetwork.solana).toBe(1);
    expect(body.mostTraded).toMatchObject({ mint: 'shared-mint' });
  });
});

describe.skipIf(!enabled)('community P&L differencing and sybil floor with PostgreSQL (L-103a)', () => {
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); });

  it('publishes totals from the same buckets as the chart, so a lone later trade is never isolated', async () => {
    const day1 = new Date(yesterday().getTime() - 2 * DAY);
    const viewer = await member(0, { closedPnl: [10], closedAt: day1 });
    for (let i = 1; i < 5; i++) await member(i, { closedPnl: [10], closedAt: day1 });
    await member(5, { closedPnl: [-37.5] }); // one member closes yesterday, alone (held back)
    auth.userId = viewer.id;
    const overview = await (await OVERVIEW()).json();
    expect(overview.pnlSeries.map((p: { value: number }) => p.value)).toEqual([50]);
    expect(overview.collectivePnl.netUsd).toBe(50);
    expect(overview.collectivePnl.netUsd - overview.pnlSeries.at(-1).value).toBe(0);
    expect(overview.collectivePnl.closedTrades).toBe(5);
    const ticker = await (await GET()).json();
    expect(ticker.netProfit).toBe(50); // same figure on both endpoints: no cross-endpoint differencing
    expect(ticker.totalLosses).toBeNull();
  });

  it('does not count members whose account is younger than a week', async () => {
    const viewer = await member(0, { closedPnl: [1] });
    for (let i = 1; i < 4; i++) await member(i, { closedPnl: [1] });
    await member(7, { closedPnl: [1], joinedDaysAgo: 1 }); // a fresh account cannot fill the floor
    auth.userId = viewer.id;
    expect((await (await GET()).json()).suppressed).toBe(true);
    const overview = await (await OVERVIEW()).json();
    expect(overview.participants).toBeNull();
    expect(overview.collectivePnl.suppressed).toBe(true);
  });
});

describe.skipIf(!enabled)('finished days and eligibility window with PostgreSQL', () => {
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); });

  it("never publishes today's bucket, so a same-day close can't move the figures", async () => {
    const viewer = await member(0, { closedPnl: [13] });
    for (let i = 1; i < 5; i++) await member(i, { closedPnl: [13] });
    auth.userId = viewer.id;
    const before = await (await OVERVIEW()).json();
    expect(before.collectivePnl.netUsd).toBe(65);
    for (let i = 5; i < 11; i++) await member(i, { closedPnl: [i === 10 ? -22 : 2], closedAt: new Date() }); // six people close today
    const after = await (await OVERVIEW()).json();
    expect(after.collectivePnl.netUsd).toBe(65);
    expect(after.pnlSeries).toEqual(before.pnlSeries);
    expect((await (await GET()).json()).netProfit).toBe(65);
  });

  it('only counts trades closed after the member opted in and passed the account-age gate', async () => {
    const day = new Date(yesterday().getTime() - 3 * DAY);
    const viewer = await member(0, { closedPnl: [13], closedAt: day });
    for (let i = 1; i < 5; i++) await member(i, { closedPnl: [13], closedAt: day });
    await member(5, { closedPnl: [80], closedAt: day, optedInDaysAgo: 1 }); // opted in after that trade closed
    await member(6, { closedPnl: [70], closedAt: day, joinedDaysAgo: 9 }); // account was under a week old then
    auth.userId = viewer.id;
    const body = await (await OVERVIEW()).json();
    expect(body.collectivePnl.netUsd).toBe(65);
    expect(body.collectivePnl.closedTrades).toBe(5);
    expect((await (await GET()).json()).netProfit).toBe(65);
  });

  it('records optedInAt on opt-in, keeps it while opted in and clears it on opt-out', async () => {
    const user = await prisma.user.create({ data: { email: `${TAG}-optin-${Date.now()}@example.test` } });
    await setCommunityOptIn(user.id, true);
    const first = (await prisma.communityOptIn.findUniqueOrThrow({ where: { userId: user.id } })).optedInAt;
    expect(first).toBeInstanceOf(Date);
    await setCommunityOptIn(user.id, true);
    expect((await prisma.communityOptIn.findUniqueOrThrow({ where: { userId: user.id } })).optedInAt?.getTime()).toBe(first!.getTime());
    await setCommunityOptIn(user.id, false);
    expect((await prisma.communityOptIn.findUniqueOrThrow({ where: { userId: user.id } })).optedInAt).toBeNull();
    await setCommunityOptIn(user.id, true);
    expect((await prisma.communityOptIn.findUniqueOrThrow({ where: { userId: user.id } })).optedInAt!.getTime()).toBeGreaterThanOrEqual(first!.getTime());
  });
});

describe.skipIf(!enabled)('member erasure (L-103b) with PostgreSQL', () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it('anonymises a member with moderated posts and drops them from every aggregate, keeping the moderation trail', async () => {
    const user = await prisma.user.create({ data: { email: `ci-erasure-${Date.now()}@example.test`, displayName: 'Real Name', bio: 'about me', walletPublicKey: 'WalletPubkey111', createdAt: new Date(Date.now() - 30 * 86_400_000) } });
    await prisma.communityOptIn.create({ data: { userId: user.id, optedIn: true, optedInAt: new Date() } });
    const post = await prisma.communityPost.create({ data: { userId: user.id, body: 'my personal story', status: 'APPROVED' } });
    const event = await prisma.communityModerationEvent.create({ data: { postId: post.id, moderatorUserId: 'mod', action: 'APPROVED' } });
    const result = await anonymiseCommunityMember(user.id);
    expect(result.posts).toBe(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe(`erased-${user.id}@erased.invalid`);
    expect(after.displayName).toBeNull();
    expect(after.bio).toBeNull();
    expect(after.walletPublicKey).toBeNull();
    expect((await prisma.communityPost.findUniqueOrThrow({ where: { id: post.id } })).body).toBe(ERASED_POST_BODY);
    expect((await prisma.communityOptIn.findUniqueOrThrow({ where: { userId: user.id } })).optedIn).toBe(false);
    expect((await prisma.communityOptIn.findUniqueOrThrow({ where: { userId: user.id } })).optedInAt).toBeNull();
    expect(await prisma.communityModerationEvent.count({ where: { id: event.id } })).toBe(1);
    await expect(anonymiseCommunityMember(user.id)).resolves.toMatchObject({ posts: 1 }); // idempotent
  });
});

describe.skipIf(!enabled)('community moderation history with PostgreSQL', () => {
  afterAll(async () => {
    // Events are append-only by design, so this test leaves its rows behind in the disposable CI database.
    await prisma.$disconnect();
  });

  it('blocks UPDATE and DELETE of moderation events, and deleting a moderated post or its author', async () => {
    const user = await prisma.user.create({ data: { email: `ci-moderation-history-${Date.now()}@example.test` } });
    const post = await prisma.communityPost.create({ data: { userId: user.id, body: 'history', status: 'APPROVED' } });
    const event = await prisma.communityModerationEvent.create({ data: { postId: post.id, moderatorUserId: 'mod', action: 'APPROVED' } });
    await expect(prisma.communityModerationEvent.update({ where: { id: event.id }, data: { reason: 'edited' } })).rejects.toThrow(/append-only/);
    await expect(prisma.communityModerationEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE "app"."CommunityModerationEvent"')).rejects.toThrow(/append-only/);
    await expect(prisma.communityPost.delete({ where: { id: post.id } })).rejects.toThrow();
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
    expect(await prisma.communityModerationEvent.count({ where: { id: event.id } })).toBe(1);
  });
});
