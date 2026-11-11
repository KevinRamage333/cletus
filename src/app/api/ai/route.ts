import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { resolveAccount } from '@/lib/status';
import { brainChat } from '@/lib/brain/chat';
export const dynamic = 'force-dynamic';
/** POST /api/ai { message, conversationId? } -> { answer, ... }. Same advisory-only Brain as /api/brain. */
export async function POST(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const b = await req.json().catch(() => ({}));
    const message = String(b.message ?? '').trim();
    if (!message) throw new HttpError(400, 'message required');
    if (message.length > 4000) throw new HttpError(400, 'message too long');
    const a = await resolveAccount(u, null);
    const r = await brainChat({ userId: u.id, accountId: a.id, isAdmin: u.isAdmin, message, conversationId: b.conversationId ?? null });
    return NextResponse.json(r);
  } catch (e) { return errorResponse(e); }
}
