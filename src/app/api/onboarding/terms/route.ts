import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser, setSessionCookie } from '@/lib/auth';
import { TERMS_VERSION } from '@/lib/legal';
import { validateTermsAcceptance } from '@/lib/onboarding';

export async function POST(req: Request) {
  const u = await getSessionUser();
  if (!u) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const v = validateTermsAcceptance(body, TERMS_VERSION);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const now = new Date();
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: u.id }, data: { termsVersion: TERMS_VERSION, termsAcceptedAt: now } }),
    prisma.acceptance.create({ data: { userId: u.id, kind: 'terms', version: TERMS_VERSION, userAgent: req.headers.get('user-agent')?.slice(0, 300) } }),
  ]);
  const res = NextResponse.json({ ok: true, next: '/onboarding/risk', recorded: { userId: u.id, version: TERMS_VERSION, at: now.toISOString() } });
  await setSessionCookie(res, user);
  return res;
}
