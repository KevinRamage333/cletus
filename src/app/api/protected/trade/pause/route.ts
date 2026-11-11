import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/auth';
import { tradeAction } from '@/lib/trade-actions';
export async function POST() {
  try { return NextResponse.json(await tradeAction('pause')); } catch (e) { return errorResponse(e); }
}
