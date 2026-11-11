import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser, setSessionCookie } from '@/lib/auth';
import { RISK_VERSION, TERMS_VERSION } from '@/lib/legal';
import { validateWalletSetup } from '@/lib/onboarding';

/** Records ONLY the public key of the browser wallet. The recovery phrase / secret never leaves the browser. */
export async function POST(req: Request) {
  const u = await getSessionUser();
  if (!u) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const v = validateWalletSetup(body, u.termsVersion === TERMS_VERSION, u.riskVersion === RISK_VERSION);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const now = new Date();
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: u.id }, data: { walletPublicKey: v.publicKey, walletSource: v.source, walletSetupAt: now } }),
    prisma.acceptance.create({ data: { userId: u.id, kind: 'wallet', version: TERMS_VERSION, userAgent: req.headers.get('user-agent')?.slice(0, 300) } }),
  ]);
  const res = NextResponse.json({ ok: true, next: '/' });
  await setSessionCookie(res, user);
  return res;
}
