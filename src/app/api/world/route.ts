import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { resolveAccount } from '@/lib/status';
import { brainChat } from '@/lib/brain/chat';

export const dynamic = 'force-dynamic';

type Character = 'cletus' | 'charlotte';
const prefix = (character: Character) => `[World:${character === 'cletus' ? 'Cletus' : 'Charlotte'}] `;

export async function GET(req: Request) {
  try {
    const user = await requireOnboardedUser();
    const url = new URL(req.url);
    const character = url.searchParams.get('character');
    const conversationId = url.searchParams.get('conversationId');
    if (character !== 'cletus' && character !== 'charlotte') throw new HttpError(400, 'valid character required');
    if (!conversationId) return NextResponse.json({ messages: [] });
    const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, userId: user.id } });
    if (!conversation || !conversation.title.startsWith(prefix(character))) throw new HttpError(404, 'world conversation not found');
    const messages = await prisma.chatMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
    return NextResponse.json({
      messages: messages.map((m) => ({ role: m.role, content: m.content, at: m.createdAt })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireOnboardedUser();
    const body = await req.json().catch(() => ({}));
    const character = body.character;
    if (character !== 'cletus' && character !== 'charlotte') throw new HttpError(400, 'valid character required');
    const message = String(body.message ?? '').trim();
    if (!message) throw new HttpError(400, 'message required');
    if (message.length > 4000) throw new HttpError(400, 'message too long');
    const account = await resolveAccount(user, body.account);
    const reply = await brainChat({
      userId: user.id,
      accountId: account.id,
      isAdmin: user.isAdmin,
      message,
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
      character,
    });
    return NextResponse.json(reply);
  } catch (error) {
    return errorResponse(error);
  }
}
