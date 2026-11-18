import { NextResponse } from 'next/server';
import { listVerifications, saveVerification } from '@/lib/listing-store';
import { checkVerificationProof } from '@/lib/verified-server';
import { VERIFIED_DISCLAIMER, badgeExpiry, decideVerification, isBadgeActive } from '@/lib/verified';
import { cachedTokenFacts } from '@/lib/listing-recheck';
import { allowAll, clientIp, publicErrorMessage } from '@/lib/request-limit';
import { consumeNonce, consumeNonceInMemory } from '@/lib/withdraw-nonce';
import { walletConnectEnabled } from '@/lib/wallet-flag';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const WINDOW_MS = 10 * 60_000;

/** Step 2: verify the signature server-side, run the automated audit, record the outcome. */
export async function POST(req: Request) {
  if (!walletConnectEnabled()) return NextResponse.json({ error: 'Cletus Verified opens when wallet connect is enabled.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const proof = await checkVerificationProof(body);
  if ('error' in proof) return NextResponse.json({ error: proof.error }, { status: 400 });
  if (!allowAll([[`vsub:ip:${clientIp(req)}`, 10], [`vsub:w:${proof.wallet}`, 5], [`vsub:t:${proof.network}:${proof.token}`, 10]], WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  }
  // Single use: a signed challenge can be submitted once (only a hash of purpose+nonce is stored).
  // With a database configured, a nonce-store failure is a 503, never a per-instance memory fallback (Audit N4).
  let fresh: boolean;
  if (process.env.DATABASE_URL) {
    try { fresh = await consumeNonce('verified-siws', proof.nonce, `verified:${proof.network}:${proof.token}`, proof.expMs); }
    catch { return NextResponse.json({ error: 'Verification is temporarily unavailable. Try again shortly.' }, { status: 503 }); }
  } else {
    fresh = consumeNonceInMemory('verified-siws', proof.nonce, proof.expMs);
  }
  if (!fresh) {
    return NextResponse.json({ error: 'This signed challenge was already used. Start again.' }, { status: 400 });
  }
  let facts;
  try { facts = await cachedTokenFacts(proof.network, proof.token); }
  catch (e) { const pe = publicErrorMessage(e, 'Audit sources are unavailable right now. Try again shortly.'); return NextResponse.json({ error: pe.message }, { status: pe.status }); }
  const d = decideVerification(facts, proof.wallet, proof.signatureValid);
  const now = new Date();
  const fields = {
    network: proof.network, token: proof.token, name: facts.name, symbol: facts.symbol, wallet: proof.wallet, role: d.role,
    status: d.verified ? 'verified' as const : 'not_verified' as const, reasons: d.reasons, checks: d.checks,
    issuedAt: d.verified ? now.toISOString() : null, expiresAt: d.verified ? badgeExpiry(now).toISOString() : null,
  };
  // Only verified results are stored, plus a failed re-audit of a token that currently holds a badge (it revokes it: latest record wins).
  const hadBadge = !d.verified && (await listVerifications({ network: proof.network, token: proof.token })).some((r) => isBadgeActive(r));
  const record = d.verified || hadBadge ? await saveVerification(fields) : { ...fields, id: null, createdAt: now.toISOString() };
  return NextResponse.json({ record, stored: d.verified || hadBadge, signatureValid: proof.signatureValid, controllers: facts.controllers.map((c) => ({ role: c.role, address: c.address })), sources: facts.sources, errors: facts.errors, disclaimer: VERIFIED_DISCLAIMER }, { headers: { 'Cache-Control': 'no-store' } });
}
