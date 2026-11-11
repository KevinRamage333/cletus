import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { OWNER_COOKIE, verifyOwnerSession } from '@/lib/owner-auth';
import { bestPool } from '@/lib/dex-lookup';
import { poolOhlcv, RANGES } from '@/lib/gecko';
import { parseAddress } from '@/lib/inspector';

export const dynamic = 'force-dynamic';

/** Owner-only chart: GeckoTerminal OHLCV. Allowed in demo mode so /owner works on Vercel. */
export async function GET(req: Request) {
  const sess = await verifyOwnerSession(cookies().get(OWNER_COOKIE)?.value);
  if (!sess) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const address = parseAddress(sp.get('address') ?? '');
  if (!address) return NextResponse.json({ error: 'a Solana token or pool address is required' }, { status: 400 });
  const range = RANGES[sp.get('range') ?? ''] ? sp.get('range')! : '1H';
  const info = await bestPool(address).catch(() => null);
  const pool = parseAddress(sp.get('pool') ?? '') ?? info?.pairAddress ?? null;
  if (!pool) return NextResponse.json({ error: 'no Solana pool found for that address' }, { status: 404 });
  const o = await poolOhlcv(pool, range);
  return NextResponse.json({
    address, mint: info?.mint ?? address, pool, dexId: info?.dexId ?? null, symbol: info?.symbol ?? null,
    name: info?.name ?? null, quote: info?.quote ?? null, priceUsd: info?.priceUsd ?? null,
    change24h: info?.change24h ?? null, volume24h: info?.volume24h ?? null, mcap: info?.mcap ?? null,
    liquidityUsd: info?.liquidityUsd ?? null, candles: o.v ?? [], candlesStale: o.stale, rateLimited: o.limited, range,
    embeds: {
      geckoterminal: `https://www.geckoterminal.com/solana/pools/${pool}?embed=1&info=0&swaps=1&grayscale=0&light_chart=0&chart_type=price&resolution=1m`,
      dexscreener: `https://dexscreener.com/solana/${pool}?embed=1&theme=dark`,
    },
    markers: [],
  });
}
