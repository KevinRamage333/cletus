import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { setSessionCookie, onboardingStep } from '@/lib/auth';
import { validEmail } from '@/lib/onboarding';
import { createPaperAccount } from '@/lib/engine';
import { STEP_PAGES } from '@/lib/gate';
import { disposableRuntimeAllowed } from '@/lib/synthetic-paper';

export const dynamic = 'force-dynamic';

const UNAVAILABLE = {
  error: 'Account sign-in is temporarily unavailable while verified sign-in is being set up.',
};

/** Account access stays closed until verified identity exists. Disposable CI and test runs can still onboard. */
export async function POST(req: Request) {
  if (!disposableRuntimeAllowed()) {
    return NextResponse.json(UNAVAILABLE, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!validEmail(email)) return NextResponse.json({ error: 'enter a valid email' }, { status: 400 });
  const invite = process.env.BETA_INVITE_CODE;
  if (invite && body.inviteCode !== invite) return NextResponse.json({ error: 'invalid beta invite code' }, { status: 403 });
  const allowed = (process.env.BETA_ALLOWED_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(email)) return NextResponse.json({ error: 'this email is not on the beta list' }, { status: 403 });

  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const userCount = await prisma.user.count();
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, isAdmin: admins.includes(email) || (admins.length === 0 && userCount === 0) },
    update: admins.includes(email) ? { isAdmin: true } : {},
  });
  await createPaperAccount(user.id, user.email);
  const step = onboardingStep(user);
  const res = NextResponse.json({ ok: true, next: step === 'done' ? '/' : STEP_PAGES[step] });
  await setSessionCookie(res, user);
  return res;
}
