import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { getSessionSecret } from '@/lib/session';
import { allowedSiwsHost, issueSiwsChallenge, originFromRequest } from '@/lib/siws';
import { canonicalAddress } from '@/lib/owner-auth';

export const dynamic = 'force-dynamic';

/** Issue a SIWS challenge for the owner login. Auth only — no transaction is created. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = canonicalAddress(url.searchParams.get('publicKey') ?? '');
  if (!address) return NextResponse.json({ error: 'invalid Solana public key' }, { status: 400 });
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
  // Issue the challenge even for a non-owner address so we don't leak the owner pubkey by 403-ing only that case
  // at challenge time; login still rejects anyone who is not OWNER_WALLET.
  const issued = await issueSiwsChallenge({
    uid: 'owner',
    address,
    domain: origin.host.replace(/:\d+$/, ''),
    uri: `${origin.origin}/owner`,
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
