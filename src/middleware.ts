import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';
import { gateDecision, demoGateDecision, isSitePublic, matchesPublicPrefix } from '@/lib/gate';
import { isDemo } from '@/lib/demo';
import { TERMS_VERSION, RISK_VERSION } from '@/lib/legal';
import { FINANCIAL_CONSENT_VERSION } from '@/lib/financial-consent';
import { AGE_ATTESTATION_VERSION } from '@/lib/age';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isDemo()) {
    const publicBeforeAge = ['/onboarding/age', '/api/onboarding/age', '/whitepaper', '/cletus-whitepaper.pdf', '/legal', '/api/health', '/owner', '/api/owner', '/live', '/api/live', '/_next/', '/favicon', '/icon', '/robots.txt', '/cletus-hero.jpg', '/cletus-avatar.png', '/cletus-logo.png', '/og-image.jpg', '/apple-touch-icon.png'];
    const exempt = isSitePublic(pathname) || matchesPublicPrefix(pathname, publicBeforeAge);
    if (!exempt) {
      const demoClaims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
      if (demoClaims?.av !== AGE_ATTESTATION_VERSION) {
        const url = req.nextUrl.clone(); url.pathname = '/onboarding/age'; url.search = '';
        return NextResponse.redirect(url);
      }
    }
    const d = demoGateDecision(pathname);
    if (d.action === 'next') return NextResponse.next();
    if (d.action === 'soon') return NextResponse.json({ error: 'coming_online_soon', demo: true, message: 'Accounts and trading are coming online soon. This is a public demo.' }, { status: 503 });
    const [path, q] = d.to.split('?');
    const url = req.nextUrl.clone(); url.pathname = path; url.search = q ? `?${q}` : '';
    return NextResponse.redirect(url);
  }
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const d = gateDecision(pathname, claims, TERMS_VERSION, RISK_VERSION, FINANCIAL_CONSENT_VERSION, AGE_ATTESTATION_VERSION);
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
