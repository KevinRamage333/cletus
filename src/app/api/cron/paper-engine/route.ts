import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { ensureOperatorAccount, monitorTick, scanTick } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOCK_NAMESPACE = 20261116;
const LOCK_ID = 1;

/**
 * Vercel Cron entry point for the paper engine.
 * The advisory transaction lock prevents overlapping cron invocations from
 * opening duplicate positions or racing the position monitor.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.CLETUS_ENGINE_TRANSPORT !== 'cron') {
    return NextResponse.json({ ok: false, error: 'Set CLETUS_ENGINE_TRANSPORT=cron to enable the scheduled worker' }, { status: 409 });
  }

  const config = getConfig();
  if (config.mode !== 'simulation') {
    return NextResponse.json({
      ok: false,
      error: 'The scheduled paper worker is disabled outside simulation mode.',
      mode: config.mode,
    }, { status: 409 });
  }
  if (process.env.ENGINE_DISABLED === 'true') {
    return NextResponse.json({ ok: false, error: 'ENGINE_DISABLED=true' }, { status: 409 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const locks = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${LOCK_NAMESPACE}, ${LOCK_ID}) AS locked
      `;
      if (!locks[0]?.locked) return { skipped: true as const };

      await ensureOperatorAccount();
      const scanSummary = await scanTick();
      await monitorTick();
      const at = new Date();

      await tx.logEntry.create({
        data: {
          level: 'info',
          message: `PAPER_WORKER_HEARTBEAT scan="${scanSummary.slice(0, 220)}" monitoredAt=${at.toISOString()}`,
          accountId: null,
          createdAt: at,
        },
      });

      return { skipped: false as const, scanSummary, scannedAt: at.toISOString(), monitoredAt: at.toISOString() };
    }, { maxWait: 5_000, timeout: 55_000 });

    if (result.skipped) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'Another paper-engine tick holds the worker lock' });
    }
    return NextResponse.json({ ok: true, mode: 'simulation', ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown worker error';
    try {
      await prisma.logEntry.create({
        data: { level: 'error', message: `PAPER_WORKER_ERROR ${message.slice(0, 500)}`, accountId: null },
      });
    } catch { /* preserve the original worker error */ }
    return NextResponse.json({ ok: false, error: 'Paper engine tick failed' }, { status: 500 });
  }
}
