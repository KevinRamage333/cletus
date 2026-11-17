import { classifyPaperHeartbeat } from '@/lib/paper-heartbeat';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireOnboardedUser();
    if (!user.isAdmin) throw new HttpError(403, 'Operator only');

    const [logs, completed, failed, state] = await Promise.all([
      prisma.logEntry.findMany({
        where: { OR: [
          { message: { startsWith: 'PAPER_WORKER_HEARTBEAT' } },
          { message: { startsWith: 'PAPER_WORKER_ERROR' } },
        ] },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { createdAt: true, level: true, message: true },
      }),
      prisma.logEntry.findFirst({
        where: { message: { equals: 'PAPER_WORKER_HEARTBEAT monitor=completed' } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.logEntry.findFirst({
        where: { message: { startsWith: 'PAPER_WORKER_ERROR' } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.engineState.findUnique({
        where: { id: 'global' },
        select: { lastScanAt: true, lastError: true, killSwitch: true, pausedUntil: true },
      }),
    ]);

    const lastCompletedAt = completed?.createdAt ?? null;
    const heartbeat = classifyPaperHeartbeat(Date.now(), lastCompletedAt?.getTime() ?? null);
    const lastFailureAt = failed?.createdAt ?? null;
    const failedSinceCompletion = lastFailureAt !== null &&
      (lastCompletedAt === null || lastFailureAt > lastCompletedAt);
    return NextResponse.json({
      mode: 'simulation',
      worker: {
        status: heartbeat.status,
        heartbeatAt: lastCompletedAt,
        ageSeconds: heartbeat.ageSeconds,
        alert: heartbeat.alert || failedSinceCompletion,
        lastFailureAt,
        failedSinceCompletion,
      },
      scanner: {
        lastScanAt: state?.lastScanAt ?? null, lastError: state?.lastError ?? null,
        killSwitch: state?.killSwitch ?? null, pausedUntil: state?.pausedUntil ?? null,
      },
      events: logs,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
