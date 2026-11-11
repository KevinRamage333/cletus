import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { getConfig, isWithinSchedule } from '@/lib/config';
import { getEngineState, mem } from '@/lib/engine';
import { rpcStatus } from '@/lib/rpc-pool';
import { wsStatus } from '@/lib/helius';
import { providerOrder } from '@/lib/providers';
import { limiter, limiterParams } from '@/lib/brain/ratelimit';
import { activeGeminiModel } from '@/lib/brain/gemini';
import { xaiConfig } from '@/lib/xai';
import { resolveAccount } from '@/lib/status';
import pkg from '../../../../package.json';
export const dynamic = 'force-dynamic';

type Level = 'ok' | 'warn' | 'down';
/** System status grid for the dashboard header. Names, ages and booleans only — never URLs or keys. */
export async function GET() {
  try {
    const u = await requireOnboardedUser();
    const c = getConfig();
    const st = await getEngineState();
    const a = await resolveAccount(u, null);
    const now = Date.now();
    const rpc = rpcStatus();
    const act = rpc.endpoints.find((e) => e.name === rpc.active);
    const hasGemini = !!(process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith('your_'));
    const order = providerOrder({ BRAIN_PROVIDER: process.env.BRAIN_PROVIDER, hasGeminiKey: hasGemini, hasXaiKey: !!xaiConfig().key, enableAiBrain: c.enableAiBrain });
    const lim = limiter.get(); const lp = limiterParams();
    const scanAge = st.lastScanAt ? (now - st.lastScanAt.getTime()) / 1000 : null;
    const grid: Record<string, { level: Level; label: string; detail: string }> = {
      rpc: { level: rpc.active === 'helius' ? (act?.failures ? 'warn' : 'ok') : rpc.active ? 'warn' : 'down', label: rpc.active === 'helius' ? 'Helius RPC' : `RPC: ${rpc.active ?? 'none'}`, detail: `${act?.latencyMs ?? '—'}ms · ${rpc.switches} failovers · WS ${wsStatus().connected ? 'live' : 'idle'}` },
      ai: { level: order[0] === 'mock' ? 'warn' : lim.cooldownUntil > now ? 'warn' : 'ok', label: order[0] === 'gemini' ? 'Gemini AI' : order[0] === 'xai' ? 'Grok (xAI)' : 'Brain (offline mock)', detail: order[0] === 'gemini' ? `${activeGeminiModel(c.geminiModel)} · ${lim.count}/${lp.dailyCap} today${lim.cooldownUntil > now ? ` · cooling down ${Math.ceil((lim.cooldownUntil - now) / 1000)}s` : ''}` : order.join(' → ') },
      signals: { level: st.killSwitch ? 'down' : scanAge === null ? 'warn' : scanAge < Math.max(3 * c.tradeFrequencySeconds, 180) ? 'ok' : 'warn', label: 'Signal engine', detail: `${scanAge === null ? 'no scan yet' : `last scan ${Math.round(scanAge)}s ago`} · ${mem.candidates.length} candidates · ${st.scanCount} scans` },
      risk: { level: st.killSwitch ? 'down' : a.paused || (st.pausedUntil && st.pausedUntil.getTime() > now) ? 'warn' : 'ok', label: 'Risk manager', detail: st.killSwitch ? 'KILL SWITCH ON' : st.pausedUntil && st.pausedUntil.getTime() > now ? 'self-heal pause' : a.paused ? `paused: ${a.pauseReason ?? 'manual'}` : `armed · ${isWithinSchedule(c) ? 'in schedule' : 'outside schedule'}` },
    };
    return NextResponse.json({ version: pkg.version, mode: c.mode, grid, killSwitch: st.killSwitch });
  } catch (e) { return errorResponse(e); }
}
