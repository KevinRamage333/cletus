import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { evaluateShadowStrategies } from '@/lib/shadow-strategies';
import { getConfig } from '@/lib/config';
import { poolOhlcv } from '@/lib/gecko';
import { EVM_ADDRESS, geckoNetworkFor, selectEvmMarket } from '@/lib/evm-market';

export const dynamic = 'force-dynamic';

async function readDex(path: string): Promise<unknown> {
  try {
    const response = await fetch('https://api.dexscreener.com' + path, {
      signal: AbortSignal.timeout(9000), cache: 'no-store',
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    await requireOnboardedUser();
    const sp = new URL(req.url).searchParams;
    const chain = (sp.get('network') ?? '').toLowerCase();
    const network = geckoNetworkFor(chain);
    const address = (sp.get('address') ?? '').trim();
    if (!network || !EVM_ADDRESS.test(address)) {
      return NextResponse.json({ error: 'Select a supported EVM network and enter a valid token or pool address.' }, { status: 400 });
    }

    const token = await readDex(`/tokens/v1/${chain}/${address}`);
    let market = selectEvmMarket(token, chain, address, 'token');
    if (!market) {
      const result = await readDex(`/latest/dex/pairs/${chain}/${address}`) as { pairs?: unknown } | null;
      market = selectEvmMarket(result?.pairs, chain, address, 'pool');
      if (!market) {
        if (!Array.isArray(token) || !(Array.isArray(result?.pairs) || result?.pairs === null)) {
          return NextResponse.json({ error: 'Market data is temporarily unavailable.' }, { status: 502 });
        }
        return NextResponse.json({ error: 'No priced base-token market or matching pool found on this network.' }, { status: 404 });
      }
    }

    const range = (sp.get('range') ?? '1H').toUpperCase();
    const candles = await poolOhlcv(market.pool, range, network);
    return NextResponse.json({
      network: chain, address, ...market,
      shadowStrategies: evaluateShadowStrategies(chain, {
        freshMarket: candles.stale || candles.limited ? false : undefined,
        liquidity: market.liquidityUsd === null ? undefined : market.liquidityUsd >= getConfig().minLiquidityUsd,
      }),
      candles: candles.v ?? [], rateLimited: candles.limited, candlesStale: candles.stale,
      markers: [], whaleMarkers: [],
      embeds: {
        geckoterminal: `https://www.geckoterminal.com/${network}/pools/${market.pool}?embed=1`,
        dexscreener: `https://dexscreener.com/${chain}/${market.pool}?embed=1&theme=dark`,
      },
      sources: ['DexScreener', 'GeckoTerminal'],
      disclaimer: 'Read-only chart. EVM trading and Cletus trade markers are not supported by this chart endpoint.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
