import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/auth';
import { appContext } from '@/lib/app-api';
import { listApprovals } from '@/lib/approval-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { a } = await appContext();
    const approvals = await listApprovals(a.id);
    return NextResponse.json({ approvals });
  } catch (e) { return errorResponse(e); }
}
