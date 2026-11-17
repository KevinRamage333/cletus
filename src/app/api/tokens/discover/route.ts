import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { mem } from '@/lib/engine';
import { prisma } from '@/lib/db';
import { resolveAccount } from '@/lib/status';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const user = await requireOnboardedUser();
    const account = await resolveAccount(user, null);
    const [positions, state] = await Promise.all([
      prisma.position.findMany({ where: { accountId: account.id, status: 'open', simulated: true }, select: { mint: true, entryPrice: true, sizeUsd: true, symbol: true, openedAt: true } }),
      prisma.engineState.findUnique({ where: { id: 'global' }, select: { lastScanAt: true, scanCount: true, killSwitch: true, pausedUntil: true, lastError: true } }).catch(() => null),
    ]);
    const open = new Map(positions.map(p => [p.mint, p] as const));
    const tokens = mem.candidates.slice(0, 100).map(c => {
      const p = open.get(c.mint), price = mem.prices.get(c.mint) ?? c.priceUsd;
      const pnl = p && p.entryPrice > 0 ? (price / p.entryPrice - 1) * p.sizeUsd : null;
      return { mint:c.mint, pool:c.pairAddress, symbol:c.symbol, name:c.name, dex:c.dexId, priceUsd:price,
        marketCapUsd:c.marketCap, liquidityUsd:c.liquidityUsd, volume24hUsd:c.volume24h,
        change1hPct:c.priceChangeH1, change24hPct:c.priceChangeH24 ?? null, score:Math.round(c.composite*100),
        signals:Object.fromEntries(Object.entries(c.signals).map(([k,v])=>[k,Math.round(v*100)])),
        rejected:c.rejected ?? null, ageHours:c.ageHours, url:c.url ?? null,
        openPaperPosition:!!p, paperPnlUsd:pnl, paperPnlPct:p && p.entryPrice>0?(price/p.entryPrice-1)*100:null };
    });
    return NextResponse.json({ fetchedAt:new Date().toISOString(), candidateScanAt:mem.candidateSnapshotAt == null ? null : new Date(mem.candidateSnapshotAt).toISOString(), scanAt:state?.lastScanAt?.toISOString() ?? null,
      scanCount:state?.scanCount ?? 0, engine:{stateAvailable:state !== null,killSwitch:state?.killSwitch ?? false,pausedUntil:state?.pausedUntil?.toISOString() ?? null,lastError:state?.lastError ?? null},
      scanning:mem.scanning,scanStage:mem.scanStage,summary:mem.lastScanSummary,tokens,
      disclaimer:'Only existing simulated positions have P&L. Other tokens show market movement, not hypothetical profits.' },
      {headers:{'Cache-Control':'no-store, max-age=0'}});
  } catch(e) { return errorResponse(e); }
}