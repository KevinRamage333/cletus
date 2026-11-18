import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { listModerationQueue } from '@/lib/community-feed';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireOnboardedUser();
    return NextResponse.json(await listModerationQueue(user));
  } catch (e) { return errorResponse(e); }
}
