import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { OWNER_COOKIE, verifyOwnerSession } from '@/lib/owner-auth';
import { buildOwnerStatus } from '@/lib/owner-status';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sess = await verifyOwnerSession(cookies().get(OWNER_COOKIE)?.value);
  if (!sess) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  try {
    const payload = await buildOwnerStatus();
    return NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('[cletus] owner status', (e as Error)?.message);
    return NextResponse.json({ error: 'could not load owner status' }, { status: 500 });
  }
}
