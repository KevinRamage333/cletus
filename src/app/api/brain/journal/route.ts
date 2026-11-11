import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { resolveAccount } from '@/lib/status';
import { writeDailyJournals } from '@/lib/journal';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const a = await resolveAccount(u, new URL(req.url).searchParams.get('account'));
    const rows = await prisma.journalEntry.findMany({ where: { OR: [{ accountId: a.id }, { accountId: null }] }, orderBy: { createdAt: 'desc' }, take: 50 });
    const items = rows.map((j) => ({ id: j.id, kind: j.kind, title: j.title, content: j.content, source: j.source, at: j.createdAt }));
    return NextResponse.json({ items, entries: items });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Admin: write (or rewrite) today's daily reflections now. */
export async function POST() {
  try {
    const u = await requireOnboardedUser();
    if (!u.isAdmin) throw new HttpError(403, 'admin only');
    await writeDailyJournals(new Date(), true);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
