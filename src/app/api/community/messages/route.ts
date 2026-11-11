import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { cleanText, displayName, looksSecret, postMessage } from '@/lib/community';
export const dynamic = 'force-dynamic';
const lastPost = new Map<string, number>();

export async function GET(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const since = new URL(req.url).searchParams.get('since');
    const rows = await prisma.communityMessage.findMany({
      where: { ...(u.isAdmin ? {} : { hidden: false }), ...(since ? { createdAt: { gt: new Date(since) } } : {}) },
      orderBy: { createdAt: 'desc' }, take: 100, include: { user: { select: { id: true, email: true, displayName: true, bio: true, isAdmin: true, banned: true } } },
    });
    return NextResponse.json({
      me: { id: u.id, name: displayName(u), isAdmin: u.isAdmin, banned: u.banned, displayName: u.displayName, bio: u.bio },
      messages: rows.reverse().map((m) => ({ id: m.id, user: displayName(m.user), userId: m.user.id, bio: m.user.bio, isAdmin: m.user.isAdmin, text: m.body, at: m.createdAt, kind: m.kind, hidden: m.hidden, ...(u.isAdmin ? { authorBanned: m.user.banned } : {}) })),
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request) {
  try {
    const u = await requireOnboardedUser();
    if (u.banned) throw new HttpError(403, 'you are muted in Community');
    const b = await req.json().catch(() => ({}));
    const text = cleanText(b.text);
    if (!text) throw new HttpError(400, 'message is empty');
    if (looksSecret(text)) throw new HttpError(400, 'that looks like a private key or recovery phrase, so it was not posted. Never share those.');
    if (Date.now() - (lastPost.get(u.id) ?? 0) < 3000) throw new HttpError(429, 'one message every 3 seconds');
    lastPost.set(u.id, Date.now());
    const m = await postMessage(u.id, text);
    return NextResponse.json({ ok: true, id: m.id, at: m.createdAt, user: displayName(u) });
  } catch (e) { return errorResponse(e); }
}
