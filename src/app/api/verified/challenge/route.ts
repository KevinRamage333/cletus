import { NextResponse } from 'next/server';
import { allowedSiwsHost, originFromRequest } from '@/lib/siws';
import { issueVerificationChallenge, parseTarget } from '@/lib/verified-server';
import { allowAll, clientIp } from '@/lib/request-limit';
import { walletConnectEnabled } from '@/lib/wallet-flag';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 10 * 60_000;

/** Step 1 of Cletus Verified: a short-lived, HMAC-bound message for the developer's wallet to sign. No transaction. */
export async function POST(req: Request) {
  if (!walletConnectEnabled()) return NextResponse.json({ error: 'Cletus Verified opens when wallet connect is enabled.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const t = parseTarget(body);
  if ('error' in t) return NextResponse.json({ error: t.error }, { status: 400 });
  const domain = (originFromRequest(req)?.host ?? '').replace(/:\d+$/, '');
  if (!allowedSiwsHost(domain)) return NextResponse.json({ error: 'This host cannot issue Cletus Verified challenges.' }, { status: 400 });
  if (!allowAll([[`vch:ip:${clientIp(req)}`, 20], [`vch:w:${t.wallet}`, 10]], WINDOW_MS)) return NextResponse.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  return NextResponse.json({ ...(await issueVerificationChallenge(t, domain)), purpose: 'ownership_proof_only' }, { headers: { 'Cache-Control': 'no-store' } });
}
