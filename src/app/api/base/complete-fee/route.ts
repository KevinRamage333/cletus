import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireOnboardedUser } from '@/lib/auth';
import { getBaseCompleteFeeEstimate } from '@/lib/base-complete-fee-estimator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/base/complete-fee
 * Read-only Base quote + router gas + L1 data-fee estimate.
 * The supplied wallet address is public input only; no wallet actions occur.
 */
export async function POST(req: Request) {
  try {
    await requireOnboardedUser();
    const body = await req.json().catch(() => ({}));
    const tokenAddress = String(body.tokenAddress ?? '').trim();
    const walletAddress = String(body.walletAddress ?? '').trim();
    const side = body.side;
    const amountIn = String(body.amountIn ?? '').trim();
    const slippageBps = body.slippageBps === undefined ? undefined : Number(body.slippageBps);

    if (!/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
      throw new HttpError(400, 'A valid Base token contract address is required');
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress) || /^0x0{40}$/i.test(walletAddress)) {
      throw new HttpError(400, 'A valid public Base wallet address is required');
    }
    if (side !== 'buy' && side !== 'sell') {
      throw new HttpError(400, 'side must be buy or sell');
    }
    if (!/^\d+(\.\d+)?$/.test(amountIn) || amountIn.length > 64 || Number(amountIn) <= 0) {
      throw new HttpError(400, 'amountIn must be a positive decimal string');
    }
    if (slippageBps !== undefined && (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 300)) {
      throw new HttpError(400, 'slippageBps must be an integer from 0 to 300');
    }

    const estimate = await getBaseCompleteFeeEstimate({
      tokenAddress,
      walletAddress,
      side,
      amountIn,
      ...(slippageBps === undefined ? {} : { slippageBps }),
    });
    return NextResponse.json(estimate, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
