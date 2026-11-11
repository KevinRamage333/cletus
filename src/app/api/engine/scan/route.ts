import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { scanTick, monitorTick } from '@/lib/engine';

export async function POST() {
  try {
    const u = await requireOnboardedUser();
    if (!u.isAdmin) throw new HttpError(403, 'admin only');
    await monitorTick();
    const summary = await scanTick();
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return errorResponse(e);
  }
}
