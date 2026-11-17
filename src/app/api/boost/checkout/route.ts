import { NextResponse } from 'next/server';
import { boostSafetyFor, parseBoostTarget } from '@/lib/boost-server';
import { listBoosts } from '@/lib/listing-store';
import { boostPaymentsEnabled, boostWindow, tierById } from '@/lib/token-boost';
import { takeToken, clientIp, publicErrorMessage } from '@/lib/request-limit';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Boost checkout. Real payment collection is DISABLED: unless BOOST_PAYMENTS_ENABLED === 'true' this returns a quote
 * marked "pending approval" and takes no payment. Even when the flag is on, no provider is wired, so nothing is charged
 * and no boost is created here. Owner-granted boosts go through /api/owner/boost.
 */
export async function POST(req: Request) {
  if (!takeToken(`bco:ip:${clientIp(req)}`, 20, 10 * 60_000)) return NextResponse.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const t = parseBoostTarget(body);
  if ('error' in t) return NextResponse.json({ error: t.error }, { status: 400 });
  const tier = tierById(String(body.tier ?? ''));
  if (!tier) return NextResponse.json({ error: 'Choose a boost duration.' }, { status: 400 });
  let safety;
  try { safety = await boostSafetyFor(t.network, t.token); } catch (e) { const pe = publicErrorMessage(e); return NextResponse.json({ error: pe.message }, { status: pe.status }); }
  if (!safety.ok) return NextResponse.json({ status: 'rejected', error: 'This token does not pass the basic safety checks required for boosting.', reasons: safety.reasons }, { status: 422 });
  const window = boostWindow(tier, await listBoosts({ network: t.network, token: t.token }));
  const quote = { ...t, tier: tier.id, label: tier.label, priceUsd: tier.priceUsd, startsAt: window.startsAt.toISOString(), expiresAt: window.expiresAt.toISOString(), name: safety.name, symbol: safety.symbol };
  if (!boostPaymentsEnabled()) {
    return NextResponse.json({ status: 'payments_disabled', quote, message: 'Paid boosts are coming soon and pending approval. No payment was requested or taken.' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({ status: 'provider_not_configured', quote, message: 'Payments are enabled but no payment provider is connected yet. Nothing was charged.' }, { status: 501, headers: { 'Cache-Control': 'no-store' } });
}
