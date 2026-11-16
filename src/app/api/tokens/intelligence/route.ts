import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { parseAddress } from '@/lib/inspector';
import { inspectAddress } from '@/lib/inspector';
import { fetchPairsForMints, type DexPair } from '@/lib/dexscreener';
import { computeSignals, scoreFor } from '@/lib/signals';
import { getConfig } from '@/lib/config';
import { auditToken } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requireOnboardedUser();
    const raw = new URL(req.url).searchParams.get('mint') ?? '';
    const mint = parseAddress(raw);
    if (!mint) return NextResponse.json({ error: 'Enter a valid Solana token mint address.' }, { status: 400 });

    const c = getConfig();
    const [inspection, pairMap] = await Promise.all([
      inspectAddress(mint),
      fetchPairsForMints([mint]),
    ]);
    const pair = pairMap.get(mint) ?? null;
    if (!pair && inspection.kind !== 'token') {
      return NextResponse.json({ error: 'No Solana token or active market pair was found for that address.' }, { status: 404 });
    }

    let signals: ReturnType<typeof computeSignals> | null = null;
    let score: number | null = null;
    if (pair) {
      signals = computeSignals(pair, {
        nanoCapMax: c.nanoCapMax,
        volumeSpikeMcapPct: c.volumeSpikeMcapPct,
        breakout5mPct: c.breakout5mPct,
        buyPressureRatio: c.buyPressureRatio,
      });
      score = scoreFor(c.signalWeightSet, signals, pair, c.initialWeights);
    }

    // The sell-route check is quote-only: it does not sign or submit a transaction.
    let audit = null;
    let auditError: string | null = null;
    if (pair?.priceUsd && pair.priceUsd > 0) {
      try {
        audit = await auditToken(mint, {
          priceUsd: Number(pair.priceUsd),
          sizeUsd: 10,
          params: {
            maxHolderConcentration: c.maxHolderConcentration,
            requireLiquidityLock: c.requireLiquidityLock,
            minLpLockedPct: c.minLpLockedPct,
            maxAuditRiskScore: c.maxAuditRiskScore,
            maxSellPriceImpactPct: c.maxSellPriceImpactPct,
            maxTop10HolderPct: c.maxTop10HolderPct,
            devSellCheck: c.devSellCheck,
            blockIfDevExited: c.blockIfDevExited,
            devExitLookbackHours: c.devExitLookbackHours,
          },
          rugcheckApiKey: c.rugcheckApiKey,
          jupiterBase: c.jupiterBaseUrl,
          jupiterApiKey: c.jupiterApiKey,
        });
      } catch (e) {
        auditError = (e as Error).message.slice(0, 180);
      }
    } else {
      auditError = 'Market price unavailable; pre-trade audit could not be sized.';
    }

    const token = inspection.token;
    return NextResponse.json({
      mint,
      fetchedAt: new Date().toISOString(),
      identity: {
        name: pair?.baseToken.name ?? token?.name ?? null,
        symbol: pair?.baseToken.symbol ?? token?.symbol ?? null,
        decimals: token?.decimals ?? null,
        supply: token?.supply ?? null,
        mintAuthority: token?.mintAuthority ?? null,
        freezeAuthority: token?.freezeAuthority ?? null,
      },
      market: pair ? {
        pairAddress: pair.pairAddress,
        dex: pair.dexId,
        priceUsd: Number(pair.priceUsd) || null,
        marketCapUsd: pair.marketCap ?? pair.fdv ?? null,
        liquidityUsd: pair.liquidity?.usd ?? null,
        volume: pair.volume ?? {},
        priceChange: pair.priceChange ?? {},
        transactions: pair.txns ?? null,
        pairCreatedAt: pair.pairCreatedAt ?? null,
        pairUrl: pair.url ?? null,
      } : null,
      signals: signals ? Object.fromEntries(Object.entries(signals).map(([k, v]) => [k, Math.round(v * 100)])) : null,
      compositeScore: score === null ? null : Math.round(score * 100),
      scoreMode: c.signalWeightSet,
      security: {
        audit,
        auditError,
        holderConcentration: token?.topHolders ?? [],
        topHoldersSource: inspection.source.includes('Helius RPC') ? 'Helius RPC' : 'unavailable',
        sources: [...new Set([...inspection.source, ...(audit ? ['RugCheck', 'Jupiter quote'] : [])])],
        warnings: inspection.errors,
      },
      activity: {
        transactions: inspection.transactions.slice(0, 15),
        source: inspection.source.includes('Helius enhanced transactions') ? 'Helius enhanced transactions' : 'Solana RPC signatures',
      },
      disclaimer: 'Research and risk indicators only. Scores are heuristic, may be incomplete or stale, and are not a probability of profit or a guarantee of safety. This endpoint never signs or submits trades.',
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (e) {
    return errorResponse(e);
  }
}
