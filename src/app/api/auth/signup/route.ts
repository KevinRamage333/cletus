import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Account access requires verified identity before this route can issue sessions. */
export async function POST() {
  return NextResponse.json(
    { error: 'Account sign-in is temporarily unavailable while verified sign-in is being set up.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
