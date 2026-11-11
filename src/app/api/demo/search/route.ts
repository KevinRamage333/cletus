import { NextResponse } from 'next/server';
import { searchTokens, bestPool } from '@/lib/dex-lookup';
import { parseAddress } from '@/lib/inspector';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 64);
  if (!q) return NextResponse.json({ tokens: [] });
  const addr = parseAddress(q);
  const list = (addr ? [await bestPool(addr)] : await searchTokens(q)).filter(Boolean).slice(0, 10);
  return NextResponse.json({ tokens: list.map((p) => ({ symbol: p!.symbol, name: p!.name, address: p!.mint, pool: p!.pairAddress, priceUsd: p!.priceUsd, change24h: p!.change24h, liquidityUsd: p!.liquidityUsd })) });
}
