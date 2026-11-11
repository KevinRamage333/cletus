import { NextResponse } from 'next/server';
import { errorResponse, HttpError } from '@/lib/auth';
import { closeOwnPosition } from '@/lib/trade-actions';
export async function POST(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id') ?? ((await req.json().catch(() => ({}))) as { id?: string }).id;
    if (!id) throw new HttpError(400, 'id required');
    return NextResponse.json(await closeOwnPosition(id));
  } catch (e) { return errorResponse(e); }
}
