import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { prisma } from './db';
import { SESSION_COOKIE, signSession, verifySession } from './session';
import { TERMS_VERSION, RISK_VERSION } from './legal';
import { FINANCIAL_CONSENT_VERSION } from './financial-consent';
import { AGE_ATTESTATION_VERSION } from './age';
import { requiredStep } from './gate';

export function claimsForUser(u: User) {
  return { uid: u.id, email: u.email, adm: u.isAdmin, av: u.ageAttestationVersion, tv: u.termsVersion, rv: u.riskVersion, fc: u.financialConsentVersion, w: Boolean(u.walletSetupAt) };
}

export async function setSessionCookie(res: NextResponse, u: User) {
  const token = await signSession(claimsForUser(u));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function getSessionUser(): Promise<User | null> {
  const claims = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  return prisma.user.findUnique({ where: { id: claims.uid } });
}

/** DB-backed onboarding status (source of truth). */
export function onboardingStep(u: User | null) {
  return requiredStep(u ? { ...claimsForUser(u), iat: 0, exp: 0 } : null, TERMS_VERSION, RISK_VERSION, FINANCIAL_CONSENT_VERSION, AGE_ATTESTATION_VERSION);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** For app APIs: user must exist and have completed every onboarding step (defence in depth beyond middleware). */
export async function requireOnboardedUser() {
  const u = await getSessionUser();
  if (!u) throw new HttpError(401, 'not signed in');
  const step = onboardingStep(u);
  if (step !== 'done') throw new HttpError(403, `onboarding incomplete: ${step}`);
  return u;
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error('[cletus] api error', (e as Error)?.message);
  return NextResponse.json({ error: 'internal error' }, { status: 500 });
}
