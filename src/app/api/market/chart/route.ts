import { NextResponse } from 'next/server';
import { bestPool, searchTokens } from '@/lib/dex-lookup';
import { poolOhlcv } from '@/lib/gecko';
import { parseAddress } from '@/lib/inspector';
import { SYMBOL_QUERY, normRange } from '@/lib/live-chart';
export const dynamic = 'force-dynamic';

/**
 * Public, read-only live price chart for one Solana token: DexScreener (pool lookup, price) + GeckoTerminal OHLCV.
 * GET /api/market/chart?address=<mint|pair>[&pool=][&range=1H|4H|1D|1W] or ?q=<symbol>. No account data.
 * Upstream calls are cached and rate-limited server-side (see lib/gecko.ts, lib/dex-lookup.ts).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const range = normRange(sp.get('range'));
  let address = parseAddress(sp.get('address') ?? '');
  const q = (sp.get('q') ?? '').trim();
  try {
    if (!address && q) {
      if (!SYMBOL_QUERY.test(q)) return NextResponse.json({ error: 'invalid_query', message: 'Enter a token symbol or Solana address.' }, { status: 400 });
      const hits = await searchTokens(q.replace(/^\$/, ''));
      const exact = hits.find((h) => h.symbol?.toUpperCase() === q.replace(/^\$/, '').toUpperCase()) ?? hits[0];
      address = exact?.mint ?? null;
      if (!address) return NextResponse.json({ error: 'not_found', message: `No Solana pool found for ${q}.` }, { status: 404 });
    }
    if (!address) return NextResponse.json({ error: 'invalid_address', message: 'A Solana token or pool address is required.' }, { status: 400 });
    const info = await bestPool(address);
    const pool = parseAddress(sp.get('pool') ?? '') ?? info?.pairAddress ?? null;
    if (!pool) return NextResponse.json({ error: 'not_found', message: 'No Solana pool found for that token.' }, { status: 404 });
    const o = await poolOhlcv(pool, range);
    return NextResponse.json({
      address, mint: info?.mint ?? address, pool, range, dexId: info?.dexId ?? null, symbol: info?.symbol ?? null, name: info?.name ?? null, quote: info?.quote ?? null,
      priceUsd: info?.priceUsd ?? null, change24h: info?.change24h ?? null, volume24h: info?.volume24h ?? null, mcap: info?.mcap ?? null, liquidityUsd: info?.liquidityUsd ?? null,
      candles: o.v ?? [], stale: o.stale, rateLimited: o.limited, fetchedAt: new Date().toISOString(),
      dexscreener: `https://dexscreener.com/solana/${pool}`,
      sources: ['DexScreener', 'GeckoTerminal'],
    }, { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } });
  } catch (e) {
    return NextResponse.json({ error: 'market_data_unavailable', message: e instanceof Error ? e.message : 'unavailable' }, { status: 502 });
  }
}
