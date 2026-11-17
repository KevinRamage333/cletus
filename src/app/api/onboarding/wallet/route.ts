import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser, setSessionCookie } from '@/lib/auth';
import { RISK_VERSION, TERMS_VERSION } from '@/lib/legal';
import { AGE_ATTESTATION_VERSION } from '@/lib/age';
import { FINANCIAL_CONSENT_VERSION } from '@/lib/financial-consent';
import { validateWalletSetup } from '@/lib/onboarding';
import { getSessionSecret } from '@/lib/session';
import { parseSiwsMessage, verifySiwsResponse } from '@/lib/siws';
import { consumeNonce } from '@/lib/withdraw-nonce';
import { walletConnectEnabled } from '@/lib/wallet-flag';

export const dynamic = 'force-dynamic';

/**
 * Records a connected wallet public key after Sign-In-With-Solana, or marks the
 * user as paper-only. Secrets are always rejected.
 */
export async function POST(req: Request) {
  const u = await getSessionUser();
  if (!u) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const v = validateWalletSetup(
    body,
    u.termsVersion === TERMS_VERSION,
    u.riskVersion === RISK_VERSION,
    u.financialConsentVersion === FINANCIAL_CONSENT_VERSION,
    u.ageAttestationVersion === AGE_ATTESTATION_VERSION,
  );
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  if (v.source === 'connected' && !walletConnectEnabled()) return NextResponse.json({ error: 'wallet connect is disabled; continue in paper mode' }, { status: 403 });
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
    const f = parseSiwsMessage(String(body.message));
    const fresh = f ? await consumeNonce('onboarding-siws', f.nonce, u.id, Date.parse(f.expirationTime)) : false;
    if (!fresh) return NextResponse.json({ error: 'sign-in challenge was already used; request a new one' }, { status: 400 });
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
