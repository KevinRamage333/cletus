import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { parseAddress } from '@/lib/inspector';
import { flowStatus, whaleActivity, socialHype } from '@/lib/flow-collector';

export const dynamic = 'force-dynamic';

/** Read-only on-chain flow and social-hype snapshot for a token. */
export async function GET(req: Request) {
  try {
    await requireOnboardedUser();
    const sp = new URL(req.url).searchParams;
    const rawMint = (sp.get('mint') ?? '').trim();
    const rawSymbol = (sp.get('symbol') ?? '').trim().replace(/^\$/, '').slice(0, 16);
    const mint = rawMint ? parseAddress(rawMint) : null;
    if (rawMint && !mint) return NextResponse.json({ error: 'Invalid Solana mint address.' }, { status: 400 });
    if (!mint && !/^[a-zA-Z0-9._-]{1,16}$/.test(rawSymbol)) {
      return NextResponse.json({ error: 'Provide a valid token mint or symbol.' }, { status: 400 });
    }

    const query = { ...(mint ? { mint } : {}), ...(!mint ? { symbol: rawSymbol } : {}) };
    const [flow, hype] = await Promise.all([
      whaleActivity(query),
      Promise.resolve(socialHype(query)),
    ]);
    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      status: flowStatus(),
      flow,
      social: hype,
      disclaimer: 'Wallet-flow observations depend on the collector being enabled and its coverage window. Missing data is not evidence of no whale, developer, or smart-money activity. Social metrics are not proof of organic interest.',
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (e) {
    return errorResponse(e);
  }
}
