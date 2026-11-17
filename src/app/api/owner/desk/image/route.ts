import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { OWNER_COOKIE, verifyOwnerSession } from '@/lib/owner-auth';
import { isSafeBoxPath } from '@/lib/owners-desk';
import { loadOwnersDeskImage } from '@/lib/owners-desk-db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sess = await verifyOwnerSession((await cookies()).get(OWNER_COOKIE)?.value);
  if (!sess) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const path = new URL(req.url).searchParams.get('path') ?? '';
  if (!isSafeBoxPath(path)) return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  const image = await loadOwnersDeskImage(path);
  if (!image) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return new NextResponse(new Uint8Array(image.bytes), {
    status: 200,
    headers: {
      'content-type': image.contentType,
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
