import { NextResponse } from 'next/server';
import { getSessionSecret } from '@/lib/session';
import { verifySiwsResponse } from '@/lib/siws';
import { canonicalAddress, isOwnerWallet, ownerCookieOptions, OWNER_COOKIE, signOwnerSession } from '@/lib/owner-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const address = canonicalAddress(body.publicKey ?? body.address);
  if (!address) return NextResponse.json({ error: 'invalid Solana public key' }, { status: 400 });
  const err = await verifySiwsResponse({
    message: String(body.message ?? ''),
    signature: String(body.signature ?? ''),
    challenge: String(body.challenge ?? ''),
    address,
    uid: 'owner',
    secret: getSessionSecret(),
  });
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  if (!isOwnerWallet(address)) {
    return NextResponse.json({ error: 'this wallet is not the owner wallet', redirect: '/demo' }, { status: 403 });
  }
  const token = await signOwnerSession(address);
  const res = NextResponse.json({ ok: true, next: '/owner', address });
  res.cookies.set(OWNER_COOKIE, token, ownerCookieOptions());
  return res;
}
