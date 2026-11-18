import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { OWNER_COOKIE, verifyOwnerSession } from '@/lib/owner-auth';
import { isSafeBoxPath } from '@/lib/owners-desk';
import { loadOwnersDeskDoc } from '@/lib/owners-desk-db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sess = await verifyOwnerSession((await cookies()).get(OWNER_COOKIE)?.value);
  if (!sess) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const path = new URL(req.url).searchParams.get('path') ?? '';
  if (!isSafeBoxPath(path)) return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  const doc = await loadOwnersDeskDoc(path);
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(doc, { headers: { 'cache-control': 'no-store' } });
}
