import { NextResponse } from 'next/server';
import { getSessionSecret } from '@/lib/session';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { verifyChallengeToken, verifySiwsResponse } from '@/lib/siws';
import { canonicalAddress, isOwnerWallet, ownerCookieOptions, OWNER_COOKIE, signOwnerSession } from '@/lib/owner-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const address = canonicalAddress(body.publicKey ?? body.address);
  if (!address) return NextResponse.json({ error: 'invalid Solana public key' }, { status: 400 });
  const challenge = String(body.challenge ?? '');
  const secret = getSessionSecret();
  const err = await verifySiwsResponse({
    message: String(body.message ?? ''),
    signature: String(body.signature ?? ''),
    challenge,
    address,
    uid: 'owner',
    secret,
  });
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  if (!isOwnerWallet(address)) {
    return NextResponse.json({ error: 'this wallet is not the owner wallet', redirect: '/demo' }, { status: 403 });
  }
  const claims = await verifyChallengeToken(challenge, secret);
  if (!claims) return NextResponse.json({ error: 'sign-in challenge expired' }, { status: 400 });
  const nonceId = createHash('sha256').update(claims.nonce).digest('hex');
  try {
    // The primary key allows one successful redemption across all app instances.
    const consumed = await prisma.logEntry.createMany({
      data: [{ id: `owner-siws-${nonceId}`, level: 'info', message: 'Owner sign-in challenge redeemed', accountId: null }],
      skipDuplicates: true,
    });
    if (consumed.count !== 1) {
      return NextResponse.json({ error: 'sign-in challenge already used' }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: 'Owner sign-in temporarily unavailable' }, { status: 503 });
  }
  const token = await signOwnerSession(address, secret);
  const res = NextResponse.json({ ok: true, next: '/owner', address });
  res.cookies.set(OWNER_COOKIE, token, ownerCookieOptions());
  return res;
}
