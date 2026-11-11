import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { mem } from '@/lib/engine';

export const dynamic = 'force-dynamic';

export async function GET() {
  const c = getConfig();
  return NextResponse.json({ ok: true, mode: c.mode, engineStarted: mem.started, lastScan: mem.lastScanSummary });
}
