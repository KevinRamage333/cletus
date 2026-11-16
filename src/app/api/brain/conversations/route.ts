import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const u = await requireOnboardedUser();
    const rows = await prisma.conversation.findMany({ where: { userId: u.id, NOT: { title: { startsWith: '[World:' } } }, orderBy: { updatedAt: 'desc' }, take: 100, include: { _count: { select: { messages: true } } } });
    return NextResponse.json({ items: rows.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messages: c._count.messages })) });
  } catch (e) {
    return errorResponse(e);
  }
}
