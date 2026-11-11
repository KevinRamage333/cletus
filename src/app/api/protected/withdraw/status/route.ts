import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/auth';
import { appContext } from '@/lib/app-api';
import { getConfig } from '@/lib/config';
import { prisma } from '@/lib/db';
import { availability, balanceLamports, liveWithdrawEnabled, reserveLamports, LAMPORTS_PER_SOL } from '@/lib/withdraw-server';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { u } = await appContext();
    const av = availability(u.isAdmin);
    if (!av.available) return NextResponse.json({ available: false, reason: av.reason });
    const op = await prisma.account.findFirst({ where: { isOperator: true } });
    const [lamports, openPositions, history] = await Promise.all([
      balanceLamports(av.operator).catch(() => null),
      op ? prisma.position.count({ where: { accountId: op.id, status: 'open' } }) : 0,
      prisma.withdrawal.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    return NextResponse.json({
      available: true, mode: getConfig().mode, liveEnabled: liveWithdrawEnabled(), operator: av.operator,
      balanceSol: lamports === null ? null : lamports / LAMPORTS_PER_SOL, reserveSol: reserveLamports() / LAMPORTS_PER_SOL, openPositions,
      history: history.map((h) => ({ at: h.createdAt, to: h.toAddress, sol: Number(h.lamports) / LAMPORTS_PER_SOL, mode: h.mode, status: h.status, signature: h.signature, error: h.error, closedPositions: h.closedPositions })),
    });
  } catch (e) { return errorResponse(e); }
}
