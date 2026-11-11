import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { getSessionUser } from '@/lib/auth';
import { RISK_VERSION, TERMS_VERSION } from '@/lib/legal';
import { getSessionSecret } from '@/lib/session';
import { allowedSiwsHost, issueSiwsChallenge, originFromRequest } from '@/lib/siws';

export const dynamic = 'force-dynamic';

/** Issue a Sign-In-With-Solana challenge. Auth only — no transaction is created. */
export async function GET(req: Request) {
  const u = await getSessionUser();
  if (!u) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (u.termsVersion !== TERMS_VERSION || u.riskVersion !== RISK_VERSION) {
    return NextResponse.json({ error: 'complete the Terms and Risk Disclaimer steps first' }, { status: 403 });
  }
  const url = new URL(req.url);
  const address = (url.searchParams.get('publicKey') ?? '').trim();
  try {
    const pk = new PublicKey(address);
    if (pk.toBase58() !== address) throw new Error('non-canonical');
  } catch {
    return NextResponse.json({ error: 'invalid Solana public key' }, { status: 400 });
  }
  const origin = originFromRequest(req);
  if (!origin || !allowedSiwsHost(origin.host)) {
    return NextResponse.json({ error: 'sign-in is not available from this host' }, { status: 400 });
  }
  const issued = await issueSiwsChallenge({
    uid: u.id,
    address,
    domain: origin.host.replace(/:\d+$/, ''),
    uri: `${origin.origin}/onboarding/wallet`,
    secret: getSessionSecret(),
  });
  return NextResponse.json({
    message: issued.message,
    challenge: issued.challenge,
    expiresAt: issued.expiresAt,
    statement: issued.fields.statement,
    purpose: 'authentication_only',
  });
}
