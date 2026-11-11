import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { errorResponse, requireOnboardedUser, setSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Drop the connected public key. The user stays onboarded in paper mode. No keys are held, so none are deleted. */
export async function POST() {
  try {
    const u = await requireOnboardedUser();
    const user = await prisma.user.update({
      where: { id: u.id },
      data: { walletPublicKey: null, walletSource: 'paper' },
    });
    const res = NextResponse.json({ ok: true, source: 'paper', address: null });
    await setSessionCookie(res, user);
    return res;
  } catch (e) { return errorResponse(e); }
}
