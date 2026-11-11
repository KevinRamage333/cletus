import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { mem } from '@/lib/engine';
import { heliusConfig, wsStatus } from '@/lib/helius';
import { rpcStatus } from '@/lib/rpc-pool';
import { rugcheckStatus } from '@/lib/rugcheck';
import { collectorStatus } from '@/lib/market-data';

export const dynamic = 'force-dynamic';

/** Public health check. Reports booleans only, never URLs or keys. */
export async function GET() {
  const c = getConfig();
  const h = heliusConfig();
  return NextResponse.json({
    ok: true, mode: c.mode, engineStarted: mem.started, lastScan: mem.lastScanSummary,
    rpc: rpcStatus(), rugcheck: rugcheckStatus(), marketData: collectorStatus(), heliusWs: { enabled: h.wsEnabled, ...wsStatus() },
    brainProvider: (process.env.BRAIN_PROVIDER || 'gemini').toLowerCase(),
  });
}
