import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { inspectAddress, parseAddress } from '@/lib/inspector';
import { devAuditFrom } from '@/lib/dev-audit';
import { postMessage } from '@/lib/community';
export const dynamic = 'force-dynamic';
/** Community dev-wallet audit: real Helius data → findings, announced in the community chat. */
export async function POST(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const b = await req.json().catch(() => ({}));
    const addr = parseAddress(String(b.wallet ?? ''));
    if (!addr) throw new HttpError(400, 'paste a valid Solana address');
    const r = devAuditFrom(await inspectAddress(addr));
    let announced = false;
    if (b.announce !== false && !u.banned) { await postMessage(u.id, `🔎 Dev audit ${addr.slice(0, 4)}…${addr.slice(-4)}: ${r.status.toUpperCase()}. ${r.summary}`, 'audit'); announced = true; }
    return NextResponse.json({ ...r, announced });
  } catch (e) { return errorResponse(e); }
}
