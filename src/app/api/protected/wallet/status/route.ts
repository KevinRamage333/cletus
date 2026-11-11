import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/auth';
import { appContext } from '@/lib/app-api';
import { walletBalances } from '@/lib/balances';
import { trialInfo } from '@/lib/trial';
import { getConfig } from '@/lib/config';
import { getOperatorPublicKey } from '@/lib/wallet';
export const dynamic = 'force-dynamic';
/** The user's connected wallet (public address only; non-custodial) with live on-chain SOL/USDC balances. Admins also see the operator wallet. */
export async function GET() {
  try {
    const { u } = await appContext();
    const bal = u.walletPublicKey ? await walletBalances(u.walletPublicKey) : { sol: null, usdc: null, error: null };
    const op = u.isAdmin ? getOperatorPublicKey() : null;
    return NextResponse.json({
      address: u.walletPublicKey, mode: 'external', walletSource: u.walletSource, solBalance: bal.sol ?? 0, usdcBalance: bal.usdc ?? 0, balancesKnown: bal.sol !== null, balanceError: bal.error,
      tradingMode: getConfig().mode, operator: op ? { address: op, ...(await walletBalances(op)) } : null, ...trialInfo(u),
    });
  } catch (e) { return errorResponse(e); }
}
