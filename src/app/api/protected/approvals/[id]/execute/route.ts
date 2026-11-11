import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/auth';
import { appContext } from '@/lib/app-api';
import { executeApproval } from '@/lib/approval-store';

export const dynamic = 'force-dynamic';

/** Submit a wallet-signed Jupiter swap. Cletus never signs this transaction. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { a, u } = await appContext();
    if (!u.walletPublicKey) return NextResponse.json({ error: 'connect your own wallet first' }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const r = await executeApproval(a.id, params.id, String(body.signedTransaction ?? ''));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  } catch (e) { return errorResponse(e); }
}
