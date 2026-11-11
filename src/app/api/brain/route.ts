import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { resolveAccount } from '@/lib/status';
import { brainChat } from '@/lib/brain/chat';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/brain                      -> { conversations }
 * GET  /api/brain?conversationId=ID    -> { id, title, messages }
 * POST /api/brain { message|question, conversationId?, account? } -> Brain reply (advisory only — never trades)
 */
export async function GET(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const id = new URL(req.url).searchParams.get('conversationId');
    if (id) {
      const c = await prisma.conversation.findFirst({ where: { id, userId: u.id } });
      if (!c) throw new HttpError(404, 'conversation not found');
      const msgs = await prisma.chatMessage.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: 'asc' } });
      return NextResponse.json({ id: c.id, title: c.title, messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, meta: m.meta ? JSON.parse(m.meta) : null, at: m.createdAt })) });
    }
    const rows = await prisma.conversation.findMany({ where: { userId: u.id }, orderBy: { updatedAt: 'desc' }, take: 100, include: { _count: { select: { messages: true } } } });
    return NextResponse.json({ conversations: rows.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messages: c._count.messages })) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const body = await req.json().catch(() => ({}));
    const message = String(body.message ?? body.question ?? '').trim();
    if (!message) throw new HttpError(400, 'message required');
    if (message.length > 4000) throw new HttpError(400, 'message too long');
    const a = await resolveAccount(u, body.account);
    return NextResponse.json(await brainChat({ userId: u.id, accountId: a.id, isAdmin: u.isAdmin, message, conversationId: body.conversationId ?? null }));
  } catch (e) {
    return errorResponse(e);
  }
}
