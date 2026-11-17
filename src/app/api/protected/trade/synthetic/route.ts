import { NextResponse } from 'next/server';
import { errorResponse, HttpError } from '@/lib/auth';
import { appContext } from '@/lib/app-api';
import { syntheticPaperFill } from '@/lib/synthetic-paper';

/** Test-only simulated fill. Refuses unless CLETUS_SYNTHETIC_PAPER=1 and trading mode is not live. */
export async function POST(req: Request) {
  try {
    const { a } = await appContext();
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const side = body.side ?? url.searchParams.get('side');
    if (side !== 'buy' && side !== 'sell') throw new HttpError(400, 'side must be buy or sell');
    return NextResponse.json(await syntheticPaperFill(a, side));
  } catch (e) { return errorResponse(e); }
}
