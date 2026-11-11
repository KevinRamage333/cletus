import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { resolveAccount } from '@/lib/status';
import { brainChat } from '@/lib/brain/chat';

export const dynamic = 'force-dynamic';

/** Multi-turn Brain chat. Body: { message, conversationId?, account? }. Advisory only — never trades. */
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
