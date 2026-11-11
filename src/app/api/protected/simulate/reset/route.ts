import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/auth';
import { appContext, resetPaper } from '@/lib/app-api';

/** Reset: wipe paper trades, restore the configured capital, and stop (press Start to run again). */
export async function POST() {
  try {
    const { a, s } = await appContext();
    const capital = s.capital ?? a.startingBalance;
    await resetPaper(a, capital, false);
    return NextResponse.json({ ok: true, running: false, capital });
  } catch (e) { return errorResponse(e); }
}
