import { NextResponse } from 'next/server';
import { errorResponse, HttpError } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { computeSend, issueToken, validateDestination, CONFIRM_WORD, TOKEN_TTL_MS } from '@/lib/withdraw';
import { ownerContext, balanceLamports, ownerSecret, reserveLamports, LAMPORTS_PER_SOL, liveWithdrawEnabled } from '@/lib/withdraw-server';
export const dynamic = 'force-dynamic';
/** POST { to, amountSol?, max?, closePositions? } -> validated plan + one-time confirmation token (2 min). Sends nothing. */
export async function POST(req: Request) {
  try {
    const { u, operator } = await ownerContext();
    const b = (await req.json().catch(() => ({}))) as { to?: string; amountSol?: number; max?: boolean; closePositions?: boolean };
    const dest = validateDestination(b.to, operator);
    if (!dest.ok) throw new HttpError(400, dest.error);
    const mode = getConfig().mode;
    const reserve = reserveLamports();
    const bal = await balanceLamports(operator).catch(() => { throw new HttpError(503, 'Could not read the wallet balance from RPC; try again'); });
    // With "close all positions" the balance can grow after the sells, so the amount is re-checked at confirm time
    // against the balance then; here we only require a positive amount (or Max).
    let lamports = 0;
    if (!b.max) {
      const a = Number(b.amountSol);
      if (!Number.isFinite(a) || a <= 0) throw new HttpError(400, 'Enter an amount greater than 0, or choose Max');
      lamports = Math.round(a * LAMPORTS_PER_SOL);
    }
    if (!b.closePositions) {
      const amt = computeSend({ balanceLamports: bal, amountSol: b.amountSol, max: !!b.max, reserveLamports: reserve });
      if (!amt.ok) throw new HttpError(400, amt.error);
    }
    const token = issueToken({ uid: u.id, to: dest.address, lamports, max: !!b.max, closePositions: !!b.closePositions, mode }, ownerSecret());
    return NextResponse.json({
      token, expiresInSec: TOKEN_TTL_MS / 1000, confirmWord: CONFIRM_WORD,
      summary: {
        from: operator, to: dest.address, amountSol: b.max ? null : lamports / LAMPORTS_PER_SOL, max: !!b.max,
        currentBalanceSol: bal / LAMPORTS_PER_SOL, reserveSol: reserve / LAMPORTS_PER_SOL, feeSol: 5000 / LAMPORTS_PER_SOL,
        closePositions: !!b.closePositions, mode, liveEnabled: liveWithdrawEnabled(),
        note: mode === 'simulation' ? 'Simulation mode: this will be validated and logged, but NO transaction will be sent.' : liveWithdrawEnabled() ? 'LIVE: this sends real SOL and cannot be undone.' : 'Live withdrawals are disabled on this worker (WITHDRAW_LIVE_ENABLED is not true).',
      },
    });
  } catch (e) { return errorResponse(e); }
}
