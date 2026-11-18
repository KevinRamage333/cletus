import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { loadCommunityFeed, submitCommunityPost } from '@/lib/community-feed';
export const dynamic = 'force-dynamic';

/** Public feed: approved posts plus the caller's own pending and rejected posts. No account ids or email names. */
export async function GET() {
  try {
    const user = await requireOnboardedUser();
    const feed = await loadCommunityFeed(user);
    return NextResponse.json({
      me: feed.me,
      messages: [...feed.posts, ...feed.mine.filter((post) => post.status && post.status !== 'APPROVED')].map((post) => ({
        id: post.id,
        user: post.authorLabel,
        text: post.body,
        at: post.createdAt,
        status: post.status ?? 'APPROVED',
        mine: Boolean(post.mine),
      })),
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request) {
  try {
    const user = await requireOnboardedUser();
    const body = await req.json().catch(() => ({}));
    const text = body.text ?? body.body;
    if (body.parentId) throw new HttpError(400, 'Replies use the thread route.');
    const post = await submitCommunityPost(user.id, text);
    return NextResponse.json({ ok: true, id: post.id, status: post.status, at: post.createdAt, message: post.message });
  } catch (e) { return errorResponse(e); }
}
