import { NextResponse } from 'next/server';
import { whaleMarkers as whaleMarkers_ } from '@/lib/flow-collector';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { resolveAccount } from '@/lib/status';
import { bestPool } from '@/lib/dex-lookup';
import { poolOhlcv, RANGES } from '@/lib/gecko';
import { storedCandles } from '@/lib/market-data';
import { parseAddress } from '@/lib/inspector';
export const dynamic = 'force-dynamic';

/** GET /api/tokens/chart?address=<mint|pair>&range=1D[&pool=] -> candles (GeckoTerminal), pool, embed URLs, and Cletus's own buy/sell markers. */
export async function GET(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const sp = new URL(req.url).searchParams;
    const address = parseAddress(sp.get('address') ?? sp.get('id') ?? '');
    if (!address) throw new HttpError(400, 'a Solana token or pool address is required');
    const range = (sp.get('range') ?? '1D').toUpperCase();
    const info = await bestPool(address);
    const pool = parseAddress(sp.get('pool') ?? '') ?? info?.pairAddress ?? null;
    if (!pool) throw new HttpError(404, 'no Solana pool found for that address');
    const o = await poolOhlcv(pool, RANGES[range] ? range : '1D');
    // 1H fallback: Cletus's own 1m candles (market_data collector) when GeckoTerminal is rate-limited/unavailable.
    let fromStore = false;
    if (!o.v?.length && (RANGES[range] ? range : '1D') === '1H') {
      const own = await storedCandles(pool, Math.floor(Date.now() / 1000) - 3600).catch(() => []);
      if (own.length) { o.v = own; fromStore = true; }
    }
    const mint = info?.mint ?? address;
    const a = await resolveAccount(u, null);
    const since = o.v?.length ? new Date(o.v[0].time * 1000) : new Date(Date.now() - 86_400_000);
    const pos = await prisma.position.findMany({ where: { accountId: a.id, mint, OR: [{ openedAt: { gte: since } }, { closedAt: { gte: since } }, { status: 'open' }] }, take: 200 });
    const markers = pos.flatMap((p) => [
      { time: Math.floor(p.openedAt.getTime() / 1000), side: 'buy', price: p.entryPrice, sizeUsd: p.sizeUsd + p.partialCostUsd, simulated: p.simulated },
      ...(p.closedAt && p.exitPrice ? [{ time: Math.floor(p.closedAt.getTime() / 1000), side: 'sell', price: p.exitPrice, pnlUsd: p.pnlUsd, reason: p.exitReason, simulated: p.simulated }] : []),
    ]);
    const whaleMarkers = await whaleMarkers_(mint, Math.floor(since.getTime() / 1000));
    return NextResponse.json({
      address, mint, pool, dexId: info?.dexId ?? null, symbol: info?.symbol ?? null, name: info?.name ?? null, quote: info?.quote ?? null,
      priceUsd: info?.priceUsd ?? null, change24h: info?.change24h ?? null, volume24h: info?.volume24h ?? null, mcap: info?.mcap ?? null, liquidityUsd: info?.liquidityUsd ?? null,
      candles: o.v ?? [], candlesStale: o.stale, rateLimited: o.limited, candlesSource: fromStore ? 'cletus market_data' : 'geckoterminal', range,
      embeds: {
        geckoterminal: `https://www.geckoterminal.com/solana/pools/${pool}?embed=1&info=0&swaps=1&grayscale=0&light_chart=0&chart_type=price&resolution=1m`,
        dexscreener: `https://dexscreener.com/solana/${pool}?embed=1&theme=dark`,
      },
      markers,
      whaleMarkers,
      sources: ['DexScreener (pool lookup)', 'GeckoTerminal (OHLCV)'],
    });
  } catch (e) { return errorResponse(e); }
}
