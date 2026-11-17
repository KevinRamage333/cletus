import { NextResponse } from 'next/server';
import { originFromRequest } from '@/lib/siws';
import { issueVerificationChallenge, parseTarget } from '@/lib/verified-server';
export const dynamic = 'force-dynamic';

/** Step 1 of Cletus Verified: a short-lived, HMAC-bound message for the developer's wallet to sign. No transaction. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const t = parseTarget(body);
  if ('error' in t) return NextResponse.json({ error: t.error }, { status: 400 });
  const domain = (originFromRequest(req)?.host ?? 'cletustechnology.dev').replace(/:\d+$/, '');
  return NextResponse.json({ ...(await issueVerificationChallenge(t, domain)), purpose: 'ownership_proof_only' }, { headers: { 'Cache-Control': 'no-store' } });
}
