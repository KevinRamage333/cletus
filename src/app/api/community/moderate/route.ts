import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { moderateCommunityPost, type ReviewAction } from '@/lib/community-feed';
import { log } from '@/lib/logger';

/**
 * Moderator decisions are append-only. Hide/unhide no longer overwrites a post.
 * { postId, action: APPROVED|REJECTED, reason? } or { userId, action: ban|unban }.
 */
export async function POST(req: Request) {
  try {
    const user = await requireOnboardedUser();
    const body = await req.json().catch(() => ({}));
    if (body.action === 'APPROVED' || body.action === 'REJECTED') {
      const result = await moderateCommunityPost(user, String(body.postId ?? body.messageId ?? ''), body.action as ReviewAction, body.reason);
      await log('info', `community ${result.status} ${result.postId}`);
      return NextResponse.json({ ok: true, ...result });
    }
    if ((body.action === 'ban' || body.action === 'unban') && body.userId) {
      if (!user.isAdmin) throw new HttpError(403, 'admins only');
      if (body.userId === user.id) throw new HttpError(400, 'you cannot mute yourself');
      await prisma.user.update({ where: { id: String(body.userId) }, data: { banned: body.action === 'ban' } });
      await log('info', `community moderation: ${body.action} user`);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'hide' || body.action === 'unhide') {
      throw new HttpError(400, 'Posts are approved or rejected once. A second decision is not applied.');
    }
    throw new HttpError(400, 'bad moderation request');
  } catch (e) { return errorResponse(e); }
}
