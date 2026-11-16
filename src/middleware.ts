import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';
import { gateDecision, demoGateDecision } from '@/lib/gate';
import { isDemo } from '@/lib/demo';
import { TERMS_VERSION, RISK_VERSION } from '@/lib/legal';
import { FINANCIAL_CONSENT_VERSION } from '@/lib/financial-consent';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isDemo()) {
    const d = demoGateDecision(pathname);
    if (d.action === 'next') return NextResponse.next();
    if (d.action === 'soon') return NextResponse.json({ error: 'coming_online_soon', demo: true, message: 'Accounts and trading are coming online soon. This is a public demo.' }, { status: 503 });
    const [path, q] = d.to.split('?');
    const url = req.nextUrl.clone(); url.pathname = path; url.search = q ? `?${q}` : '';
    return NextResponse.redirect(url);
  }
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const d = gateDecision(pathname, claims, TERMS_VERSION, RISK_VERSION, FINANCIAL_CONSENT_VERSION);
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
