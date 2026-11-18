import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';

const auth = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/auth', async (orig) => {
  const real = await orig<typeof import('@/lib/auth')>();
  return { ...real, requireOnboardedUser: vi.fn(async () => ({ id: auth.userId })) };
});

import { GET } from '@/app/api/community/collective-pnl/route';
import { GET as OVERVIEW } from '@/app/api/community/overview/route';

const enabled = process.env.PAPER_SETTLEMENT_PG_TEST === '1';
const TAG = 'ci-community-privacy';

async function member(n: number, opts: { optedIn?: boolean; banned?: boolean; closedPnl?: Array<number | null>; open?: number; mint?: string } = {}) {
  const user = await prisma.user.create({ data: { email: `${TAG}-${n}-${Date.now()}@example.test`, banned: opts.banned ?? false } });
  await prisma.communityOptIn.create({ data: { userId: user.id, optedIn: opts.optedIn ?? true } });
  const account = await prisma.account.create({ data: { userId: user.id, name: `${TAG}-${n}`, startingBalance: 100, cashUsd: 100, peakEquity: 100 } });
  for (const pnl of opts.closedPnl ?? []) {
    await prisma.position.create({
      data: {
        accountId: account.id, mint: opts.mint ?? `mint-${n}`, symbol: 'TEST', status: 'closed', simulated: true,
        entryPrice: 1, sizeUsd: 10, tokenAmount: 10, highestPrice: 1, lastPrice: 1, compositeScore: 0, signals: '{}',
        closedAt: new Date(), exitPrice: 1, pnlUsd: pnl,
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
    expect(body.totalGains).toBe(20);
    expect(body.totalLosses).toBe(4);
    expect(body.netProfit).toBe(16);
    expect(body.winningTrades).toBe(5);
    expect(body.losingTrades).toBe(1);
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
    expect(body.collectivePnl).toMatchObject({ suppressed: false, netUsd: 16, gainsUsd: 20, lossesUsd: -4, closedTrades: 6 });
    expect(body.tokensPerNetwork.solana).toBe(1);
    expect(body.mostTraded).toMatchObject({ mint: 'shared-mint' });
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
