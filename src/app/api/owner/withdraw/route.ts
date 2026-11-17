import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { OWNER_COOKIE, verifyOwnerSession } from '@/lib/owner-auth';
import { getSessionSecret } from '@/lib/session';
import { loadOwnerState, pushOwnerState, saveOwnerState } from '@/lib/owner-store';
import { CONFIRM_WORD, issueToken, verifyToken } from '@/lib/withdraw';
import { KOL_TRADING_WALLET, LAMPORTS, mergeRequests, newRequest, type WithdrawWallet } from '@/lib/owner-withdraw-queue';
import { OWNER_TRADING_WALLET } from '@/lib/owner-plan';

export const dynamic = 'force-dynamic';

/**
 * Owner withdrawals. The site NEVER signs or sends: step 1 previews and returns
 * a 2-minute HMAC token, step 2 (typed WITHDRAW) queues a confirmed request.
 * The box worker executes it only if the destination is on its allowlist, the
 * daily cap holds and OWNER_REMOTE_WITHDRAW=on — see owner-withdraw-queue.ts.
 */
async function owner() {
  return verifyOwnerSession((await cookies()).get(OWNER_COOKIE)?.value);
}

export async function GET() {
  const sess = await owner();
  if (!sess) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const s = loadOwnerState();
  return NextResponse.json({
    deposit: [
      { wallet: 'main', label: 'Main trading wallet (Solana)', address: OWNER_TRADING_WALLET },
      { wallet: 'kol', label: 'KOL / pump.fun wallet (Solana)', address: KOL_TRADING_WALLET },
    ],
    requests: (s.withdrawals ?? []).slice(-15).reverse(),
  }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request) {
  const sess = await owner();
  if (!sess) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const secret = getSessionSecret();
  const uid = `owner:${sess.addr}`;
  if (body.step === 'preview') {
    const wallet: WithdrawWallet = body.wallet === 'kol' ? 'kol' : 'main';
    const check = newRequest({ wallet, to: String(body.to ?? '').trim(), amountSol: Number(body.amountSol), by: sess.addr });
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    const r = check.request;
    const token = issueToken({ uid, to: `${wallet}:${r.to}`, lamports: r.lamports, max: false, closePositions: false, mode: 'live' }, secret);
    return NextResponse.json({
      ok: true, token, confirmWord: CONFIRM_WORD,
      summary: `Send ${(r.lamports / LAMPORTS).toFixed(4)} SOL from the ${wallet === 'kol' ? 'KOL' : 'main'} wallet to ${r.to}. The box worker sends it only if this address is on your allowlist and today's cap allows it.`,
    });
  }
  if (body.step === 'confirm') {
    if (String(body.confirmWord ?? '').trim().toUpperCase() !== CONFIRM_WORD) return NextResponse.json({ error: `type ${CONFIRM_WORD} to confirm` }, { status: 400 });
    const v = verifyToken(body.token, secret, uid);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const [wallet, to] = v.plan.to.split(':') as [WithdrawWallet, string];
    const made = newRequest({ wallet, to, amountSol: v.plan.lamports / LAMPORTS, by: sess.addr });
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: 400 });
    const s = loadOwnerState();
    const saved = saveOwnerState({ ...s, withdrawals: mergeRequests(s.withdrawals, [made.request]) });
    if (!process.env.VERCEL) {
      const { syncHaltAndPublishSnapshot } = await import('@/lib/owner-sync');
      await syncHaltAndPublishSnapshot({ forcePush: true });
    } else {
      await pushOwnerState(saved);
    }
    return NextResponse.json({ ok: true, request: made.request, message: 'Queued. The box worker will pick it up within a few seconds and report sent or refused here.' });
  }
  return NextResponse.json({ error: 'step must be preview or confirm' }, { status: 400 });
}
