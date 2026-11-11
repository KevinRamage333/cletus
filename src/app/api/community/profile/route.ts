import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { cleanText } from '@/lib/community';
export async function POST(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const b = await req.json().catch(() => ({}));
    const name = cleanText(b.displayName, 24);
    if (name && !/^[\w .\-]{2,24}$/.test(name)) throw new HttpError(400, 'name: 2-24 letters, numbers, spaces, . _ -');
    const bio = cleanText(b.bio, 160);
    if (name) {
      const taken = await prisma.user.findFirst({ where: { displayName: name, NOT: { id: u.id } } });
      if (taken) throw new HttpError(409, 'that name is taken');
    }
    await prisma.user.update({ where: { id: u.id }, data: { displayName: name || null, bio: bio || null } });
    return NextResponse.json({ ok: true, displayName: name || null, bio: bio || null });
  } catch (e) { return errorResponse(e); }
}
