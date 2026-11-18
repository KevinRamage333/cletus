import { NextResponse } from 'next/server';
import { errorResponse, HttpError } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { executeWithdraw, verifyAndConsumeToken, cooldownOk, CONFIRM_WORD } from '@/lib/withdraw';
import { ownerContext, deps, ownerSecret, reserveLamports } from '@/lib/withdraw-server';
import { consumeWithdrawConfirmNonce } from '@/lib/withdraw-nonce';
export const dynamic = 'force-dynamic';
/** POST { token, confirm: "WITHDRAW" } -> executes the previewed plan (simulated in simulation mode). */
export async function POST(req: Request) {
  try {
    const { u, operator } = await ownerContext();
    const b = (await req.json().catch(() => ({}))) as { token?: string; confirm?: string };
    if (String(b.confirm ?? '').trim() !== CONFIRM_WORD) throw new HttpError(400, `Type ${CONFIRM_WORD} to confirm`);
    const secret = ownerSecret();
    const v = await verifyAndConsumeToken(b.token, secret, u.id, (nonce, exp) => consumeWithdrawConfirmNonce(nonce, u.id, exp));
    if (!v.ok) throw new HttpError(400, v.error);
    if (v.plan.mode !== getConfig().mode) throw new HttpError(409, 'Trading mode changed since the preview; preview again');
    if (v.plan.to === operator) throw new HttpError(400, 'That is the trading wallet itself');
    if (!cooldownOk(u.id)) throw new HttpError(429, 'One withdrawal every 30 seconds');
    const r = await executeWithdraw(v.plan, deps(u.id, operator), reserveLamports());
    return NextResponse.json(r, { status: r.status === 'refused' ? 400 : r.status === 'failed' ? 502 : 200 });
  } catch (e) { return errorResponse(e); }
}
