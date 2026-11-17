import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { evaluateShadowStrategies } from '@/lib/shadow-strategies';
import { getConfig } from '@/lib/config';
import { mem } from '@/lib/engine';
import { prisma } from '@/lib/db';
import { readCandidateSnapshot } from '@/lib/candidate-snapshot';
import { resolveAccount } from '@/lib/status';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const user = await requireOnboardedUser();
    const account = await resolveAccount(user, null);
    const [positions, state] = await Promise.all([
      prisma.position.findMany({ where: { accountId: account.id, status: 'open', simulated: true }, select: { mint: true, sizeUsd: true, tokenAmount: true, feesUsd: true } }),
      prisma.engineState.findUnique({ where: { id: 'global' }, select: { lastScanAt: true, candidateSnapshot: true, scanCount: true, killSwitch: true, pausedUntil: true, lastError: true } }).catch(() => null),
    ]);
    const open = new Map(positions.map(p => [p.mint, p] as const));
    const stored = readCandidateSnapshot(state?.candidateSnapshot);
    const useStored = stored !== null && stored.at > (mem.candidateSnapshotAt ?? -Infinity);
    const snapshotAt = useStored ? stored.at : mem.candidateSnapshotAt;
    const candidates = useStored ? stored.candidates : mem.candidates;
    const snapshotAgeMs = snapshotAt == null || !Number.isFinite(snapshotAt) ? null : Math.max(0, Date.now() - snapshotAt);
    const snapshotFresh = snapshotAgeMs !== null && snapshotAgeMs <= 120_000;
    // Preserve old candidates for historical inspection, never advertise them as actionable signals.
    const minimumLiquidity = getConfig().minLiquidityUsd;
    const tokens = candidates.slice(0, 100).map(c => {
      const p = open.get(c.mint), price = useStored ? c.priceUsd : mem.prices.get(c.mint) ?? c.priceUsd;
      const pnl = p && p.sizeUsd > 0 ? price * p.tokenAmount - p.sizeUsd - p.feesUsd : null;
      return { mint:c.mint, pool:c.pairAddress, symbol:c.symbol, name:c.name, dex:c.dexId, priceUsd:price,
        marketCapUsd:c.marketCap, liquidityUsd:c.liquidityUsd, volume24hUsd:c.volume24h,
        change1hPct:c.priceChangeH1, change24hPct:c.priceChangeH24 ?? null, score:Math.round(c.composite*100),
        signals:Object.fromEntries(Object.entries(c.signals).map(([k,v])=>[k,Math.round(v*100)])),
        rejected:c.rejected ?? null, actionable: snapshotFresh && state !== null && !state.killSwitch && (!state.pausedUntil || state.pausedUntil.getTime() <= Date.now()), ageHours:c.ageHours, url:c.url ?? null,
        shadowStrategies: evaluateShadowStrategies('solana', {
          freshMarket: snapshotFresh,
          liquidity: c.liquidityUsd == null ? undefined : c.liquidityUsd >= minimumLiquidity,
          entry: c.rejected ? false : undefined,
        }),
        openPaperPosition:!!p, paperPnlUsd:pnl, paperPnlPct:p && pnl !== null ? pnl / p.sizeUsd * 100 : null };
    });
    return NextResponse.json({ fetchedAt:new Date().toISOString(), candidateScanAt:snapshotAt == null ? null : new Date(snapshotAt).toISOString(), scanAt:state?.lastScanAt?.toISOString() ?? null,
      snapshotFresh, snapshotAgeSeconds:snapshotAgeMs === null ? null : Math.floor(snapshotAgeMs / 1000), scanCount:state?.scanCount ?? 0, engine:{stateAvailable:state !== null,killSwitch:state?.killSwitch ?? true,pausedUntil:state?.pausedUntil?.toISOString() ?? null,lastError:state?.lastError ?? null},
      scanning:mem.scanning,scanStage:mem.scanStage,summary:mem.lastScanSummary,tokens,
      disclaimer:'Only existing simulated positions have P&L. Other tokens show market movement, not hypothetical profits.' },
      {headers:{'Cache-Control':'no-store, max-age=0'}});
  } catch(e) { return errorResponse(e); }
}