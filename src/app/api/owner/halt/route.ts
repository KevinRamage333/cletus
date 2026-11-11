import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { OWNER_COOKIE, verifyOwnerSession } from '@/lib/owner-auth';
import { requestOwnerHalt } from '@/lib/owner-sync';
import { loadOwnerState } from '@/lib/owner-store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const sess = await verifyOwnerSession(cookies().get(OWNER_COOKIE)?.value);
  if (!sess) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const action = body.action === 'resume' ? 'resume' : body.action === 'halt' ? 'halt' : null;
  if (!action) return NextResponse.json({ error: 'action must be halt or resume' }, { status: 400 });
  if (body.confirm !== true) return NextResponse.json({ error: 'confirmation required' }, { status: 400 });
  const result = await requestOwnerHalt(action, sess.addr, String(body.reason ?? (action === 'halt' ? 'sell all' : 'resume')));
  const state = loadOwnerState();
  return NextResponse.json({
    ok: true,
    action,
    changed: result.changed,
    already: result.already,
    halt: result.state,
    audit: result.audit,
    trail: state.audit.slice(-20),
  });
}
