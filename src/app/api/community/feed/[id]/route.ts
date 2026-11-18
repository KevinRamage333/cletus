import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { loadThread, submitCommunityPost } from '@/lib/community-feed';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireOnboardedUser();
    return NextResponse.json(await loadThread(user, id));
  } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireOnboardedUser();
    const body = await req.json().catch(() => ({}));
    const post = await submitCommunityPost(user.id, body.body ?? body.text, id);
    return NextResponse.json(post, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
