import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { log } from '@/lib/logger';
/** Admin-only: { messageId, action: hide|unhide } or { userId, action: ban|unban } */
export async function POST(req: Request) {
  try {
    const u = await requireOnboardedUser();
    if (!u.isAdmin) throw new HttpError(403, 'admins only');
    const b = await req.json().catch(() => ({}));
    if ((b.action === 'hide' || b.action === 'unhide') && b.messageId) {
      await prisma.communityMessage.update({ where: { id: String(b.messageId) }, data: { hidden: b.action === 'hide', hiddenBy: b.action === 'hide' ? u.id : null } });
    } else if ((b.action === 'ban' || b.action === 'unban') && b.userId) {
      if (b.userId === u.id) throw new HttpError(400, 'you cannot mute yourself');
      await prisma.user.update({ where: { id: String(b.userId) }, data: { banned: b.action === 'ban' } });
    } else throw new HttpError(400, 'bad moderation request');
    await log('info', `community moderation: ${b.action} ${b.messageId ?? b.userId} by admin`);
    return NextResponse.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
