import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const u = await requireOnboardedUser();
    const b = await req.json().catch(() => ({}));
    const kind = ['bug', 'feedback', 'idea'].includes(b.kind) ? b.kind : 'feedback';
    const message = String(b.message ?? '').trim();
    if (message.length < 5) throw new HttpError(400, 'please describe the issue (5+ characters)');
    const f = await prisma.feedback.create({ data: { userId: u.id, kind, message: message.slice(0, 5000), page: String(b.page ?? '').slice(0, 200) || null, severity: ['low', 'medium', 'high', 'critical'].includes(b.severity) ? b.severity : null } });
    return NextResponse.json({ ok: true, id: f.id });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET() {
  try {
    const u = await requireOnboardedUser();
    const where = u.isAdmin ? {} : { userId: u.id };
    const items = await prisma.feedback.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { email: true } } } });
    return NextResponse.json({ items: items.map((f) => ({ id: f.id, kind: f.kind, severity: f.severity, message: f.message, page: f.page, email: f.user.email, at: f.createdAt })) });
  } catch (e) {
    return errorResponse(e);
  }
}
