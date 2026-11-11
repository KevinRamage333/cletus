import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';
import { gateDecision } from '@/lib/gate';
import { TERMS_VERSION, RISK_VERSION } from '@/lib/legal';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const d = gateDecision(pathname, claims, TERMS_VERSION, RISK_VERSION);
  if (d.action === 'next') return NextResponse.next();
  if (d.action === 'deny') {
    return NextResponse.json({ error: 'onboarding_required', step: d.step }, { status: d.status });
  }
  const url = req.nextUrl.clone();
  url.pathname = d.to;
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
