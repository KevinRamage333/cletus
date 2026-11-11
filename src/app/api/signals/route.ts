import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { mem } from '@/lib/engine';
import { getConfig } from '@/lib/config';
export const dynamic = 'force-dynamic';

const LABELS: Record<string, string> = { volumeSpike: 'Volume spike', breakout: 'Breakout', buyPressure: 'Buy pressure', momentum: 'Momentum', velocitySurge: 'Velocity surge', liquidityBuild: 'Liquidity build', nanoCapSpike: 'Nano-cap spike', microCapHeat: 'Micro-cap heat', volMcapRatio: 'Vol/MCap ratio' };

/** Live scanner output (the engine's last scan). Cletus only trades long, so every signal is LONG; prices are in USD. */
export async function GET(req: Request) {
  try {
    await requireOnboardedUser();
    const sp = new URL(req.url).searchParams;
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit') ?? 50)));
    const c = getConfig();
    const list = [...mem.candidates].sort((a, b) => Number(!!a.rejected) - Number(!!b.rejected) || b.composite - a.composite).slice(0, limit);
    return NextResponse.json({
      updatedAt: new Date().toISOString(), lastScan: mem.lastScanSummary, minScore: c.minCompositeScore * 100,
      signals: list.map((x) => ({
        id: x.mint, pair: `${x.symbol}/${x.quoteSymbol ?? 'SOL'}`, base: x.symbol, quote: x.quoteSymbol ?? 'SOL', side: 'LONG', score: Math.round(x.composite * 100),
        priceUsd: x.priceUsd, change24h: x.priceChangeH24 ?? 0, change1h: x.priceChangeH1, volume24h: x.volume24h, mcap: x.marketCap, liquidityUsd: x.liquidityUsd,
        volMcap: x.volMcap, signals: Object.entries(x.signals).filter(([, v]) => v >= 0.5).map(([k]) => LABELS[k] ?? k),
        status: x.rejected ? `filtered: ${x.rejected}` : x.audit ? (x.audit.passed ? 'audit passed' : 'audit failed') : x.composite >= c.minCompositeScore ? 'qualified' : 'below threshold',
        pool: x.pairAddress, url: x.url ?? null, updatedAt: new Date().toISOString(),
      })),
    });
  } catch (e) { return errorResponse(e); }
}
