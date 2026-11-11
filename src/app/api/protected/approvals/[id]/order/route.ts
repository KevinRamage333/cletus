import { NextResponse } from 'next/server';
import { errorResponse, HttpError } from '@/lib/auth';
import { appContext } from '@/lib/app-api';
import { refreshOrder } from '@/lib/approval-store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { a, u } = await appContext();
    if (!u.walletPublicKey) throw new HttpError(400, 'connect your own wallet first; paper mode does not need approvals');
    const body = await req.json().catch(() => ({}));
    const r = await refreshOrder(a.id, params.id, u.walletPublicKey, body.slippageBps);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  } catch (e) { return errorResponse(e); }
}
