import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { reportCommunityPost } from '@/lib/community-feed';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireOnboardedUser();
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await reportCommunityPost(user.id, id, body.reason));
  } catch (e) { return errorResponse(e); }
}
