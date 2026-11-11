import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/auth';
import { appContext, tradeSession } from '@/lib/app-api';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { const { u, a, c, s } = await appContext(); return NextResponse.json(await tradeSession(u, a, c, s)); } catch (e) { return errorResponse(e); }
}
