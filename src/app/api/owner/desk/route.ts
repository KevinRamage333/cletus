import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { OWNER_COOKIE, verifyOwnerSession } from '@/lib/owner-auth';
import { loadOwnersDesk } from '@/lib/owners-desk-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sess = await verifyOwnerSession((await cookies()).get(OWNER_COOKIE)?.value);
  if (!sess) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  try {
    const payload = await loadOwnersDesk();
    return NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('[cletus] owner desk', (e as Error)?.name ?? 'Error');
    return NextResponse.json({ error: 'could not load The Owner\'s Desk' }, { status: 500 });
  }
}
