import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser, setSessionCookie } from '@/lib/auth';
import { AGE_ATTESTATION_VERSION } from '@/lib/age';
import { validateAgeAttestation } from '@/lib/onboarding';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const validation = validateAgeAttestation(body, AGE_ATTESTATION_VERSION);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { ageAttestationVersion: AGE_ATTESTATION_VERSION, ageAttestedAt: now } }),
    prisma.acceptance.create({ data: { userId: user.id, kind: 'age-18+', version: AGE_ATTESTATION_VERSION, userAgent: req.headers.get('user-agent')?.slice(0, 300) } }),
  ]);
  const response = NextResponse.json({ ok: true, next: '/onboarding/terms', recordedAt: now.toISOString() });
  await setSessionCookie(response, updated);
  return response;
}
