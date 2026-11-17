import { jupiterStatus } from '@/lib/jupiter';
import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { mem } from '@/lib/engine';
import { heliusConfig, wsStatus } from '@/lib/helius';
import { rpcStatus } from '@/lib/rpc-pool';
import { rugcheckStatus } from '@/lib/rugcheck';
import { collectorStatus } from '@/lib/market-data';
import { isDemo } from '@/lib/demo';

export const dynamic = 'force-dynamic';

/** Public health check. Reports booleans only, never URLs or keys. */
export async function GET() {
  if (isDemo()) return NextResponse.json({ ok: true, demo: true, mode: 'simulation', engine: 'offline (demo)', database: 'not connected (demo)', brain: process.env.GEMINI_API_KEY ? 'gemini (demo, rate-limited)' : 'mock (demo)' });
  const c = getConfig();
  const h = heliusConfig();
  const now = Date.now();
  const scanAgeMs = mem.lastScanDoneAt == null ? null : Math.max(0, now - mem.lastScanDoneAt);
  const monitorAgeMs = mem.lastMonitorDoneAt == null ? null : Math.max(0, now - mem.lastMonitorDoneAt);
  const staleAfterMs = 120_000;
  const heartbeatHealthy = mem.started && scanAgeMs !== null && monitorAgeMs !== null && scanAgeMs <= staleAfterMs && monitorAgeMs <= staleAfterMs;
  return NextResponse.json({
    ok: heartbeatHealthy, mode: c.mode, engineStarted: mem.started, lastScan: mem.lastScanSummary,
    heartbeat: { healthy: heartbeatHealthy, scanAgeMs, monitorAgeMs, staleAfterMs, scanStage: mem.scanStage, monitorStage: mem.monitorStage },
    rpc: rpcStatus(), rugcheck: rugcheckStatus(), marketData: collectorStatus(), jupiter: jupiterStatus(), heliusWs: { enabled: h.wsEnabled, ...wsStatus() },
    brainProvider: (process.env.BRAIN_PROVIDER || 'gemini').toLowerCase(),
  });
}
