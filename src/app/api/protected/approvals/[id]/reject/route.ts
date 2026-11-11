import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/auth';
import { appContext } from '@/lib/app-api';
import { rejectApproval } from '@/lib/approval-store';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { a } = await appContext();
    const r = await rejectApproval(a.id, params.id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  } catch (e) { return errorResponse(e); }
}
