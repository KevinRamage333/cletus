import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { errorResponse, HttpError } from '@/lib/auth';
import { appContext } from '@/lib/app-api';
import { trialInfo } from '@/lib/trial';
export const dynamic = 'force-dynamic';
/** Tax-responsibility acknowledgment. Stores only a timestamp; tax IDs / SSNs are never collected or stored. */
export async function GET() {
  try { const { u } = await appContext(); return NextResponse.json({ taxAckAt: u.taxAckAt, ...trialInfo(u) }); } catch (e) { return errorResponse(e); }
}
export async function POST(req: Request) {
  try {
    const { u } = await appContext();
    const b = await req.json().catch(() => ({}));
    const forbidden = ['taxId', 'ssn', 'tin', 'ein', 'itin', 'nationalId'];
    if (Object.keys(b).some((k) => forbidden.includes(k))) throw new HttpError(400, 'Cletus does not collect tax IDs. Remove that field.');
    if (!b.acknowledgeTaxResponsibility || !b.acknowledgeReporting) throw new HttpError(400, 'both acknowledgments are required');
    const at = new Date();
    await prisma.user.update({ where: { id: u.id }, data: { taxAckAt: at, trialStartedAt: u.trialStartedAt ?? u.createdAt } });
    return NextResponse.json({ ok: true, taxAckAt: at });
  } catch (e) { return errorResponse(e); }
}
