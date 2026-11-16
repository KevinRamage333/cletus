import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser, setSessionCookie } from '@/lib/auth';
import { isDemo } from '@/lib/demo';
import { SESSION_COOKIE, signSession } from '@/lib/session';
import { AGE_ATTESTATION_VERSION } from '@/lib/age';
import { validateAgeAttestation } from '@/lib/onboarding';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const validation = validateAgeAttestation(body, AGE_ATTESTATION_VERSION);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  if (isDemo()) {
    const token = await signSession({ uid: 'public-demo-age-attestation', email: 'demo-age@cletus.invalid', adm: false, av: AGE_ATTESTATION_VERSION, tv: null, rv: null, fc: null, w: false }, undefined, 60 * 60 * 24);
    const response = NextResponse.json({ ok: true, next: '/demo' });
    response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false', path: '/', maxAge: 60 * 60 * 24 });
    return response;
  }

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { ageAttestationVersion: AGE_ATTESTATION_VERSION, ageAttestedAt: now } }),
    prisma.acceptance.create({ data: { userId: user.id, kind: 'age-18+', version: AGE_ATTESTATION_VERSION, userAgent: req.headers.get('user-agent')?.slice(0, 300) } }),
  ]);
  const response = NextResponse.json({ ok: true, next: '/onboarding/terms', recordedAt: now.toISOString() });
  await setSessionCookie(response, updated);
  return response;
}
