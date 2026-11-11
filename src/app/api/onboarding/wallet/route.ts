import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser, setSessionCookie } from '@/lib/auth';
import { RISK_VERSION, TERMS_VERSION } from '@/lib/legal';
import { validateWalletSetup } from '@/lib/onboarding';
import { getSessionSecret } from '@/lib/session';
import { verifySiwsResponse } from '@/lib/siws';

export const dynamic = 'force-dynamic';

/**
 * Records a connected wallet public key after Sign-In-With-Solana, or marks the
 * user as paper-only. The recovery phrase / secret must never be sent.
 */
export async function POST(req: Request) {
  const u = await getSessionUser();
  if (!u) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const v = validateWalletSetup(body, u.termsVersion === TERMS_VERSION, u.riskVersion === RISK_VERSION);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  if (v.source === 'connected') {
    const err = await verifySiwsResponse({
      message: String(body.message),
      signature: String(body.signature),
      challenge: String(body.challenge),
      address: v.publicKey!,
      uid: u.id,
      secret: getSessionSecret(),
    });
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  const now = new Date();
  const data = v.source === 'paper'
    ? { walletPublicKey: null as string | null, walletSource: 'paper', walletSetupAt: now }
    : { walletPublicKey: v.publicKey!, walletSource: 'connected', walletSetupAt: now };
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: u.id }, data }),
    prisma.acceptance.create({ data: { userId: u.id, kind: 'wallet', version: TERMS_VERSION, userAgent: req.headers.get('user-agent')?.slice(0, 300) } }),
  ]);
  const res = NextResponse.json({ ok: true, next: '/app', source: v.source, publicKey: user.walletPublicKey });
  await setSessionCookie(res, user);
  return res;
}
