import { NextResponse } from 'next/server';
import { OWNER_COOKIE, ownerCookieOptions } from '@/lib/owner-auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(OWNER_COOKIE, '', { ...ownerCookieOptions(0), maxAge: 0 });
  return res;
}

export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL('/owner', req.url));
  res.cookies.set(OWNER_COOKIE, '', { ...ownerCookieOptions(0), maxAge: 0 });
  return res;
}
