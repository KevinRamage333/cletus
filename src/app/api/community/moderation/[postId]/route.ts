import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { moderateCommunityPost, type ReviewAction } from '@/lib/community-feed';

export async function POST(req: Request, { params }: { params: { postId: string } }) {
  try {
    const user = await requireOnboardedUser();
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (action !== 'APPROVED' && action !== 'REJECTED') throw new HttpError(400, 'action must be APPROVED or REJECTED');
    return NextResponse.json(await moderateCommunityPost(user, params.postId, action as ReviewAction, body.reason));
  } catch (e) { return errorResponse(e); }
}
