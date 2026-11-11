import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { searchTokens, bestPool } from '@/lib/dex-lookup';
import { parseAddress } from '@/lib/inspector';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    await requireOnboardedUser();
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 64);
    if (!q) return NextResponse.json({ tokens: [] });
    const addr = parseAddress(q);
    const list = addr ? [await bestPool(addr)].filter(Boolean) : await searchTokens(q);
    return NextResponse.json({ tokens: list.map((p) => ({ id: p!.mint, symbol: p!.symbol, name: p!.name, address: p!.mint, pool: p!.pairAddress, image: p!.image ?? undefined, priceUsd: p!.priceUsd ?? undefined, change24h: p!.change24h ?? undefined, volume24h: p!.volume24h ?? undefined, mcap: p!.mcap ?? undefined, liquidityUsd: p!.liquidityUsd ?? undefined })) });
  } catch (e) { return errorResponse(e); }
}
