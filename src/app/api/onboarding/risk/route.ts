import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser, setSessionCookie } from '@/lib/auth';
import { RISK_VERSION, TERMS_VERSION } from '@/lib/legal';
import { validateRiskAck } from '@/lib/onboarding';

export async function POST(req: Request) {
  const u = await getSessionUser();
  if (!u) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const v = validateRiskAck(body, RISK_VERSION, u.termsVersion === TERMS_VERSION ? RISK_VERSION : null);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const now = new Date();
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: u.id }, data: { riskVersion: RISK_VERSION, riskAckAt: now } }),
    prisma.acceptance.create({ data: { userId: u.id, kind: 'risk', version: RISK_VERSION, userAgent: req.headers.get('user-agent')?.slice(0, 300) } }),
  ]);
  const res = NextResponse.json({ ok: true, next: user.walletSetupAt ? '/' : '/onboarding/wallet', recorded: { userId: u.id, version: RISK_VERSION, at: now.toISOString() } });
  await setSessionCookie(res, user);
  return res;
}
