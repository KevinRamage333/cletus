import { NextResponse } from 'next/server';
import { boostSafetyFor, parseBoostTarget } from '@/lib/boost-server';
import { takeToken, clientIp, publicErrorMessage } from '@/lib/request-limit';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Basic safety gate a token must pass before it can be boosted. Read-only. */
export async function POST(req: Request) {
  if (!takeToken(`bchk:ip:${clientIp(req)}`, 20, 10 * 60_000)) return NextResponse.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  const t = parseBoostTarget(await req.json().catch(() => ({})));
  if ('error' in t) return NextResponse.json({ error: t.error }, { status: 400 });
  try { return NextResponse.json({ ...t, ...(await boostSafetyFor(t.network, t.token)) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (e) { const pe = publicErrorMessage(e); return NextResponse.json({ error: pe.message }, { status: pe.status }); }
}
