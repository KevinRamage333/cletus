import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { PUBLIC_LIVE_POSITIONS_WHERE } from '@/lib/public-live';

// Only the database path is under test: no box trade log and no owner snapshot.
vi.mock('@/lib/live-trades', async (orig) => ({ ...(await orig<typeof import('@/lib/live-trades')>()), readLiveTrades: () => [] }));
vi.mock('@/lib/owner-store', async (orig) => ({ ...(await orig<typeof import('@/lib/owner-store')>()), loadOwnerState: () => ({ snapshot: null }), snapshotAgeMs: () => null }));

import { GET } from '@/app/api/live/route';

const enabled = process.env.PAPER_SETTLEMENT_PG_TEST === '1';
const TAG = 'ci-public-live-scope';
const HOUSE = `HSE${Date.now() % 100000}`;
const MEMBER = `MBR${Date.now() % 100000}`;

async function closedPosition(accountId: string, symbol: string) {
  await prisma.position.create({
    data: {
      accountId, mint: `${TAG}-${symbol}`, symbol, status: 'closed', simulated: true,
      entryPrice: 1, sizeUsd: 10, tokenAmount: 10, highestPrice: 1, lastPrice: 1, compositeScore: 0, signals: '{}',
      closedAt: new Date(), exitPrice: 1.1, pnlUsd: 1, pnlPct: 10,
    },
  });
}

async function cleanup() {
  await prisma.position.deleteMany({ where: { mint: { startsWith: TAG } } });
  await prisma.account.deleteMany({ where: { name: { startsWith: TAG } } });
  const users = await prisma.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
  await prisma.communityOptIn.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

describe('public /api/live ticker scope', () => {
  it('reads closed positions of the operator (house) account only', () => {
    expect(PUBLIC_LIVE_POSITIONS_WHERE).toEqual({ status: 'closed', account: { isOperator: true } });
  });
});

describe.skipIf(!enabled)('public /api/live ticker with PostgreSQL', () => {
  beforeAll(async () => {
    await cleanup();
    const house = await prisma.account.create({ data: { name: `${TAG}-house`, isOperator: true, startingBalance: 100, cashUsd: 100, peakEquity: 100 } });
    await closedPosition(house.id, HOUSE);
    // A member who even opted in to the community: their trades still never reach the public feed.
    const user = await prisma.user.create({ data: { email: `${TAG}-${Date.now()}@example.test` } });
    await prisma.communityOptIn.create({ data: { userId: user.id, optedIn: true } });
    const member = await prisma.account.create({ data: { userId: user.id, name: `${TAG}-member`, startingBalance: 100, cashUsd: 100, peakEquity: 100 } });
    await closedPosition(member.id, MEMBER);
  });
  afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

  it("shows the house trade and never a member's trade", async () => {
    const body = await (await GET()).json();
    const tokens = [...(body.ticker ?? []), ...(body.simulation?.ticker ?? [])].map((t: { token: string }) => t.token);
    expect(tokens).toContain(HOUSE);
    expect(tokens).not.toContain(MEMBER);
  });
});
