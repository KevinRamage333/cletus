import { NextResponse } from 'next/server';
import { listVerifications } from '@/lib/listing-store';
import { VERIFIED_DISCLAIMER, isBadgeActive, latestRecordByToken, networkMeta, normalizeAddress, type ListingNetwork } from '@/lib/verified';
import { recheckListing } from '@/lib/listing-recheck';
export const dynamic = 'force-dynamic';

/** Public: currently verified tokens, or the history for one token (?network=&token=). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const meta = networkMeta(u.searchParams.get('network') ?? '');
  const token = meta && u.searchParams.get('token') ? normalizeAddress(meta.id, u.searchParams.get('token')!) : null;
  const rows = await listVerifications(meta ? { network: meta.id, ...(token ? { token } : {}) } : {});
  const now = Date.now();
  // Latest record wins (a newer failed audit hides an older badge), then a live re-check (~1h cache) can drop it.
  const latest = latestRecordByToken(rows).filter((r) => isBadgeActive(r, now)).slice(0, 50);
  const checked = await Promise.all(latest.map(async (r) => ({ r, c: await recheckListing(r.network as ListingNetwork, r.token, now) })));
  const strip = (r: (typeof rows)[number]) => ({ id: r.id, network: r.network, token: r.token, name: r.name, symbol: r.symbol, status: r.status, role: r.role, issuedAt: r.issuedAt, expiresAt: r.expiresAt, createdAt: r.createdAt, reasons: r.reasons, checks: r.checks });
  return NextResponse.json({
    verified: checked.filter((x) => x.c.ok).map((x) => ({ ...strip(x.r), checkedAt: x.c.checkedAt })),
    dropped: checked.filter((x) => !x.c.ok).map((x) => ({ network: x.r.network, token: x.r.token, reasons: x.c.drops, checkedAt: x.c.checkedAt })),
    history: token ? rows.slice(0, 20).map(strip) : undefined,
    disclaimer: VERIFIED_DISCLAIMER,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
