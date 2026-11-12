import { NextResponse } from 'next/server';
import { authorizedSnapshotRequest, loadOwnerState, saveOwnerState } from '@/lib/owner-store';
import { mergeHalt } from '@/lib/owner-halt';
import { mergeRequests } from '@/lib/owner-withdraw-queue';

export const dynamic = 'force-dynamic';

/** Authenticated box ↔ Vercel channel for owner snapshots and halt commands. */
export async function GET(req: Request) {
  if (!authorizedSnapshotRequest(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(loadOwnerState(), { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!authorizedSnapshotRequest(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const current = loadOwnerState();
  const halt = body.halt ? mergeHalt(current.halt, body.halt) : current.halt;
  const incomingAsOf = body.snapshot?.asOf ? Date.parse(body.snapshot.asOf) : 0;
  const haveAsOf = current.snapshot?.asOf ? Date.parse(current.snapshot.asOf) : 0;
  const snapshot = incomingAsOf >= haveAsOf ? (body.snapshot ?? current.snapshot) : current.snapshot;
  const audit = Array.isArray(body.audit) ? [...current.audit, ...body.audit].slice(-200) : current.audit;
  const withdrawals = mergeRequests(current.withdrawals, Array.isArray(body.withdrawals) ? body.withdrawals : []);
  const saved = saveOwnerState({ snapshot, halt, audit, withdrawals });
  return NextResponse.json({ ok: true, halt: saved.halt, asOf: saved.snapshot?.asOf ?? null });
}
