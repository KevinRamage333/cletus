import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { setCommunityOptIn } from '@/lib/community-feed';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireOnboardedUser();
    const row = await prisma.communityOptIn.findUnique({ where: { userId: user.id }, select: { optedIn: true, updatedAt: true } });
    return NextResponse.json({ optedIn: row?.optedIn === true, updatedAt: row?.updatedAt?.toISOString() ?? null });
  } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request) {
  try {
    const user = await requireOnboardedUser();
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await setCommunityOptIn(user.id, body.enabled));
  } catch (e) { return errorResponse(e); }
}
