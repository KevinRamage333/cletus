import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/auth';
import { appContext } from '@/lib/app-api';
import { executeApproval } from '@/lib/approval-store';
import { getConfig } from '@/lib/config';
import { userSwapExecuteAllowed } from '@/lib/user-swaps';

export const dynamic = 'force-dynamic';

/** Submit a wallet-signed Jupiter swap. Cletus never signs this transaction. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Send path: closed before auth/DB unless live mode AND USER_SWAP_EXECUTE_ENABLED=true.
  let mode: string;
  try { mode = getConfig().mode; } catch { return NextResponse.json({ error: 'swap execution is disabled' }, { status: 403 }); }
  const gate = userSwapExecuteAllowed(mode);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const { a, u } = await appContext();
    if (!u.walletPublicKey) return NextResponse.json({ error: 'connect your own wallet first' }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const r = await executeApproval(a.id, id, String(body.signedTransaction ?? ''));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  } catch (e) { return errorResponse(e); }
}
