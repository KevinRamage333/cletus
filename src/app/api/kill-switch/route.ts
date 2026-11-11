import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { setKillSwitch } from '@/lib/engine';
import { getConfig } from '@/lib/config';

export async function POST(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const body = await req.json().catch(() => ({}));
    const active = body.active !== false;
    if (!getConfig().enableKillSwitch) throw new HttpError(400, 'kill switch disabled by ENABLE_KILL_SWITCH=false');
    // Anyone may ACTIVATE (fail safe). Only admins may release it.
    if (!active && !u.isAdmin) throw new HttpError(403, 'only an admin can release the kill switch');
    await setKillSwitch(active, String(body.reason ?? `manual by ${u.email}`).slice(0, 200));
    return NextResponse.json({ ok: true, killSwitch: active });
  } catch (e) {
    return errorResponse(e);
  }
}
