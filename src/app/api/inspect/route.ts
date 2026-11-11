import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { inspectAddress, parseAddress } from '@/lib/inspector';
export const dynamic = 'force-dynamic';
const last = new Map<string, number>();
/** GET /api/inspect?address= — live wallet/token view via Helius (read-only). Per-user throttle: 1 lookup / 2s. */
export async function GET(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const addr = parseAddress(new URL(req.url).searchParams.get('address') ?? '');
    if (!addr) throw new HttpError(400, 'paste a valid Solana wallet or token address');
    const t = last.get(u.id) ?? 0;
    if (Date.now() - t < 2000) throw new HttpError(429, 'slow down a little');
    last.set(u.id, Date.now());
    return NextResponse.json(await inspectAddress(addr));
  } catch (e) { return errorResponse(e); }
}
