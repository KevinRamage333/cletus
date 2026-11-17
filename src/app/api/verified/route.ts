import { NextResponse } from 'next/server';
import { listVerifications } from '@/lib/listing-store';
import { VERIFIED_DISCLAIMER, isBadgeActive, networkMeta, normalizeAddress } from '@/lib/verified';
export const dynamic = 'force-dynamic';

/** Public: currently verified tokens, or the history for one token (?network=&token=). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const meta = networkMeta(u.searchParams.get('network') ?? '');
  const token = meta && u.searchParams.get('token') ? normalizeAddress(meta.id, u.searchParams.get('token')!) : null;
  const rows = await listVerifications(meta ? { network: meta.id, ...(token ? { token } : {}) } : {});
  const now = Date.now();
  const active = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (isBadgeActive(r, now) && !active.has(`${r.network}:${r.token}`)) active.set(`${r.network}:${r.token}`, r);
  const strip = (r: (typeof rows)[number]) => ({ id: r.id, network: r.network, token: r.token, name: r.name, symbol: r.symbol, status: r.status, role: r.role, issuedAt: r.issuedAt, expiresAt: r.expiresAt, createdAt: r.createdAt, reasons: r.reasons, checks: r.checks });
  return NextResponse.json({
    verified: Array.from(active.values()).map(strip),
    history: token ? rows.slice(0, 20).map(strip) : undefined,
    disclaimer: VERIFIED_DISCLAIMER,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
