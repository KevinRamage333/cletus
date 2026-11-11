import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/auth';
import { appContext, saveSettings } from '@/lib/app-api';
import { sanitizeSettings, fromConfigPage, settingsSummary, to12h, AGGRESSION_UI, LIMITS, CAPITAL_QUICK } from '@/lib/user-settings';
import { effectiveConfig } from '@/lib/user-settings';

export const dynamic = 'force-dynamic';

function view(s: ReturnType<typeof sanitizeSettings>, c: Parameters<typeof effectiveConfig>[0], startingBalance: number) {
  const e = effectiveConfig(c, s);
  return {
    settings: s, summary: settingsSummary(s, c), limits: LIMITS, capitalQuick: CAPITAL_QUICK,
    page: {
      capital: s.capital ?? startingBalance, activeDays: s.activeDays, startTime: to12h(s.tradingStart), endTime: to12h(s.tradingEnd), tradingHoursEnabled: s.tradingHoursEnabled, timezone: s.timezone,
      aggression: AGGRESSION_UI[e.aggression], positionSizePercent: s.positionSizePct, stopLossPercent: e.stopLossPct, takeProfitPercent: e.takeProfitPct,
      dailyProfitTarget: s.dailyProfitTargetUsd, dailyMaxLoss: s.dailyMaxLossUsd, maxPositions: s.maxConcurrent,
    },
    server: { maxOpenPositions: c.maxOpenPositions, maxPositionPctOfEquity: c.maxPositionPctOfEquity, mode: c.mode },
  };
}

export async function GET() {
  try { const { a, c, s } = await appContext(); return NextResponse.json(view(s, c, a.startingBalance)); } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request) {
  try {
    const { a, c, s } = await appContext();
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const next = sanitizeSettings(fromConfigPage(b), s);
    await saveSettings(a.id, next);
    return NextResponse.json({ ok: true, ...view(next, c, a.startingBalance) });
  } catch (e) { return errorResponse(e); }
}
