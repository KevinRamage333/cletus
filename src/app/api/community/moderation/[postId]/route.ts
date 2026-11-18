import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { moderateCommunityPost, type ReviewAction } from '@/lib/community-feed';

export async function POST(req: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    const { postId } = await params;
    const user = await requireOnboardedUser();
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (action !== 'APPROVED' && action !== 'REJECTED') throw new HttpError(400, 'action must be APPROVED or REJECTED');
    return NextResponse.json(await moderateCommunityPost(user, postId, action as ReviewAction, body.reason));
  } catch (e) { return errorResponse(e); }
}
