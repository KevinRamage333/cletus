import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '@/lib/auth';
import {
  anonLabelKey,
  anonymousAuthorLabel,
  collectiveFiguresVisible,
  commitPost,
  commitReview,
  sanitizePostBody,
  toFeedPost,
  toQueuePost,
  type CommunityTx,
  type PostRecord,
  type ReviewAction,
} from '@/lib/community-feed';
import { COMMUNITY_FEED_HREF, threadHref } from '@/lib/community-paths';

class MemoryTx implements CommunityTx {
  optedIn = true;
  posts: PostRecord[] = [];
  events: Array<{ postId: string; action: ReviewAction; reason: string | null }> = [];
  locked = false;

  async lockOptIn() {
    this.locked = true;
    return this.optedIn;
  }
  async recentPosts(userId: string, since: Date) {
    return this.posts.filter((post) => post.userId === userId && post.createdAt >= since).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async lockPost(id: string) {
    return this.posts.find((post) => post.id === id) ?? null;
  }
  async insertPost(input: { userId: string; body: string; parentId: string | null }) {
    const row: PostRecord = { id: `p${this.posts.length + 1}`, userId: input.userId, parentId: input.parentId, body: input.body, status: 'PENDING', moderationReason: null, createdAt: new Date(), replyCount: 0 };
    this.posts.push(row);
    return row;
  }
  async writeDecision(input: { postId: string; action: ReviewAction; reason: string | null }) {
    const post = this.posts.find((row) => row.id === input.postId);
    if (!post) throw new Error('missing');
    post.status = input.action;
    post.moderationReason = input.reason;
    this.events.push({ postId: input.postId, action: input.action, reason: input.reason });
  }
  async addReport() { return 'created' as const; }
  async countReports() { return 0; }
  async flagPost() {}
}

const author = 'user_alice';
const other = 'user_bob';

describe('community feed rules', () => {
  beforeAll(() => { process.env.COMMUNITY_ANON_SALT = 'test-only-anon-label-key-0123456789'; });

  it('keeps a new post out of the public feed until it is approved', async () => {
    const tx = new MemoryTx();
    const created = await commitPost(tx, author, 'Hello from the paper desk', null);
    expect(created.status).toBe('PENDING');
    expect(tx.locked).toBe(true);
    expect(toFeedPost(created, other)).toBeNull();
    const own = toFeedPost(created, author);
    expect(own?.status).toBe('PENDING');
    expect(own?.mine).toBe(true);
    await commitReview(tx, 'mod', created.id, 'APPROVED', null);
    expect(toFeedPost(tx.posts[0], other)?.authorLabel).toMatch(/^Member /);
    expect(tx.events).toEqual([{ postId: created.id, action: 'APPROVED', reason: null }]);
  });

  it('rejects a second moderation decision and does not append another event', async () => {
    const tx = new MemoryTx();
    const created = await commitPost(tx, author, 'Needs review', null);
    await commitReview(tx, 'mod', created.id, 'REJECTED', 'spam');
    await expect(commitReview(tx, 'mod', created.id, 'APPROVED', null)).rejects.toMatchObject({ status: 409 });
    expect(tx.events).toHaveLength(1);
    expect(tx.posts[0].status).toBe('REJECTED');
  });

  it('refuses a post when the locked opt-in row is off', async () => {
    const tx = new MemoryTx();
    tx.optedIn = false;
    await expect(commitPost(tx, author, 'too late', null)).rejects.toThrow(/Opt in/);
    expect(tx.posts).toHaveLength(0);
  });

  it('does not let a moderator review their own post', async () => {
    const tx = new MemoryTx();
    const created = await commitPost(tx, 'mod', 'my own announcement', null);
    await expect(commitReview(tx, 'mod', created.id, 'APPROVED', null)).rejects.toMatchObject({ status: 403 });
    expect(tx.events).toHaveLength(0);
    expect(tx.posts[0].status).toBe('PENDING');
  });

  it('keys the anonymous label with a server secret and uses 8 hex chars', () => {
    const a = anonymousAuthorLabel(author, 'first-server-secret-0123456789');
    const b = anonymousAuthorLabel(author, 'second-server-secret-0123456789');
    expect(a).toMatch(/^Member [0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(anonymousAuthorLabel(author, 'first-server-secret-0123456789')).toBe(a);
    expect(() => anonLabelKey({} as NodeJS.ProcessEnv)).toThrow(HttpError);
    expect(anonLabelKey({ SESSION_SECRET: 'session-secret-fallback-0123456789' } as unknown as NodeJS.ProcessEnv)).toBe('session-secret-fallback-0123456789');
  });

  it('hides collective figures below five contributors', () => {
    expect(collectiveFiguresVisible(4)).toBe(false);
    expect(collectiveFiguresVisible(5)).toBe(true);
  });

  it('uses an anonymous label and omits account identity', () => {
    const row: PostRecord = { id: 'p', userId: author, parentId: null, body: 'hi', status: 'APPROVED', moderationReason: null, createdAt: new Date('2026-11-17T00:00:00Z') };
    const pub = toFeedPost(row, other)!;
    expect(pub.authorLabel).toBe(anonymousAuthorLabel(author));
    expect(JSON.stringify(pub)).not.toContain(author);
    expect(JSON.stringify(pub)).not.toContain('@');
    expect(toQueuePost(row).authorLabel).toBe('Private member');
    expect(JSON.stringify(toQueuePost(row))).not.toContain(author);
  });

  it('rejects an embedded recovery phrase and still allows a short note', () => {
    expect(() => sanitizePostBody('note this phrase ' + 'abandon '.repeat(12) + 'thanks')).toThrow(HttpError);
    expect(sanitizePostBody('gm everyone')).toBe('gm everyone');
  });

  it('allows ordinary long sentences that are not BIP-39 phrases', () => {
    const ordinary = [
      'This coin looks great and the team seems legit but price action today was weird',
      'I think the market is going to keep moving sideways for a while before anything happens here',
      'took profit on half the bag, letting the rest ride with a stop under the last higher low',
    ];
    for (const text of ordinary) expect(sanitizePostBody(text)).toBe(text);
  });

  it('keeps thread links inside the app shell for mobile navigation', () => {
    expect(threadHref('post 1')).toBe(`${COMMUNITY_FEED_HREF}/post%201`);
    const nav = readFileSync('src/components/BottomNav.tsx', 'utf8');
    expect(nav).toContain("href: '/app/community'");
    expect(nav).toContain('md:hidden');
  });
});
