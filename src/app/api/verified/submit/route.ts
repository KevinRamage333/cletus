import { NextResponse } from 'next/server';
import { gatherTokenFacts } from '@/lib/token-security-server';
import { saveVerification } from '@/lib/listing-store';
import { checkVerificationProof } from '@/lib/verified-server';
import { VERIFIED_DISCLAIMER, badgeExpiry, decideVerification } from '@/lib/verified';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Step 2: verify the signature server-side, run the automated audit, record the outcome. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const proof = await checkVerificationProof(body);
  if ('error' in proof) return NextResponse.json({ error: proof.error }, { status: 400 });
  let facts;
  try { facts = await gatherTokenFacts(proof.network, proof.token); }
  catch (e) { const status = (e as { status?: number }).status ?? 502; return NextResponse.json({ error: e instanceof Error ? e.message : 'Audit sources unavailable' }, { status }); }
  const d = decideVerification(facts, proof.wallet, proof.signatureValid);
  const now = new Date();
  const record = await saveVerification({
    network: proof.network, token: proof.token, name: facts.name, symbol: facts.symbol, wallet: proof.wallet, role: d.role,
    status: d.verified ? 'verified' : 'not_verified', reasons: d.reasons, checks: d.checks,
    issuedAt: d.verified ? now.toISOString() : null, expiresAt: d.verified ? badgeExpiry(now).toISOString() : null,
  });
  return NextResponse.json({ record, signatureValid: proof.signatureValid, controllers: facts.controllers.map((c) => ({ role: c.role, address: c.address })), sources: facts.sources, errors: facts.errors, disclaimer: VERIFIED_DISCLAIMER }, { headers: { 'Cache-Control': 'no-store' } });
}
