import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { OWNER_COOKIE, verifyOwnerSession } from '@/lib/owner-auth';
import { boostSafetyFor, parseBoostTarget } from '@/lib/boost-server';
import { listBoosts, saveBoost } from '@/lib/listing-store';
import { MAX_ACTIVE_BOOSTS_PER_TOKEN, boostWindow, tierById } from '@/lib/token-boost';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Owner only: all boosts including expired (audit trail). */
export async function GET() {
  const sess = await verifyOwnerSession((await cookies()).get(OWNER_COOKIE)?.value);
  if (!sess) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  return NextResponse.json({ boosts: await listBoosts({ includeExpired: true }) }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Owner only: grant a free boost (testing / partners). The token must still pass the basic safety checks. */
export async function POST(req: Request) {
  const sess = await verifyOwnerSession((await cookies()).get(OWNER_COOKIE)?.value);
  if (!sess) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.confirm !== true) return NextResponse.json({ error: 'confirmation required' }, { status: 400 });
  const t = parseBoostTarget(body);
  if ('error' in t) return NextResponse.json({ error: t.error }, { status: 400 });
  const tier = tierById(String(body.tier ?? ''));
  if (!tier) return NextResponse.json({ error: 'tier must be 12h, 24h or 7d' }, { status: 400 });
  const safety = await boostSafetyFor(t.network, t.token).catch((e: Error) => ({ ok: false, reasons: [e.message] }));
  if (!safety.ok) return NextResponse.json({ error: 'token fails basic safety checks', reasons: safety.reasons }, { status: 422 });
  const existing = await listBoosts(t);
  if (existing.filter((b) => b.status === 'active').length >= MAX_ACTIVE_BOOSTS_PER_TOKEN) return NextResponse.json({ error: 'too many stacked boosts for this token' }, { status: 409 });
  const w = boostWindow(tier, existing);
  const boost = await saveBoost({ ...t, tier: tier.id, startsAt: w.startsAt.toISOString(), expiresAt: w.expiresAt.toISOString(), source: 'owner_grant', status: 'active', createdBy: sess.addr, note: typeof body.note === 'string' ? body.note.slice(0, 200) : null });
  return NextResponse.json({ ok: true, boost });
}
