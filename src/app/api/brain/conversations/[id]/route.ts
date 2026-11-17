import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { isWorldConversationTitle } from '@/lib/brain/conversation-scope';

export const dynamic = 'force-dynamic';

async function owned(userId: string, id: string) {
  const c = await prisma.conversation.findFirst({ where: { id, userId } });
  if (!c || isWorldConversationTitle(c.title)) throw new HttpError(404, 'conversation not found');
  return c;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const u = await requireOnboardedUser();
    const c = await owned(u.id, id);
    const msgs = await prisma.chatMessage.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: 'asc' } });
    return NextResponse.json({ id: c.id, title: c.title, messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, meta: m.meta ? JSON.parse(m.meta) : null, at: m.createdAt })) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const u = await requireOnboardedUser();
    const c = await owned(u.id, id);
    await prisma.conversation.delete({ where: { id: c.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
