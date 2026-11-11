import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { buildStatus, resolveAccount } from '@/lib/status';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const a = await resolveAccount(u, new URL(req.url).searchParams.get('account'));
    return NextResponse.json(await buildStatus(u, a));
  } catch (e) {
    return errorResponse(e);
  }
}
