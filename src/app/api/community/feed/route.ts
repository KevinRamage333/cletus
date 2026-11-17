import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { loadCommunityFeed, submitCommunityPost } from '@/lib/community-feed';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireOnboardedUser();
    return NextResponse.json(await loadCommunityFeed(user));
  } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request) {
  try {
    const user = await requireOnboardedUser();
    const body = await req.json().catch(() => ({}));
    const post = await submitCommunityPost(user.id, body.body ?? body.text, null);
    return NextResponse.json(post, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
