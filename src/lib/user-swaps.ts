/**
 * User-wallet Jupiter V2 swaps. Cletus prepares an unsigned /order (taker = the
 * user's public key) and later submits the wallet-signed transaction to /execute.
 *
 * This module must never import the operator keypair or any user secret.
 * Do not add loadTradingKeypair, TRADING_WALLET_PRIVATE_KEY, seed phrases, or
 * delegated/session-key logic here.
 */
import { getOrder, executeOrder, orderTxProblem, describeExecute, RETRYABLE_EXECUTE, type JupOrder, type JupExecute } from './jupiter';

export interface PrepareSwapInput {
  taker: string;
  inputMint: string;
  outputMint: string;
  amount: bigint | string | number;
  slippageBps?: number | null;
}

export interface PreparedUserSwap {
  requestId: string;
  transaction: string;
  inAmount: string;
  outAmount: string;
  feeBps: number;
  platformFeeBps: number | null;
  referralAccount: string | null;
  priceImpactPct: number;
  slippageBps: number | null;
  router: string;
}

export async function prepareUserSwap(input: PrepareSwapInput): Promise<PreparedUserSwap> {
  const order: JupOrder = await getOrder({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount,
    taker: input.taker,
    slippageBps: input.slippageBps,
    applyOperatorFee: true,
  });
  const problem = orderTxProblem(order, true);
  if (problem) throw new Error(`jupiter /order: ${problem}`);
  return {
    requestId: order.requestId,
    transaction: order.transaction!,
    inAmount: order.inAmount,
    outAmount: order.outAmount,
    feeBps: order.feeBps,
    platformFeeBps: order.platformFeeBps,
    referralAccount: order.referralAccount,
    priceImpactPct: order.priceImpactPct,
    slippageBps: order.slippageBps,
    router: order.router,
  };
}

export async function submitUserSwap(signedTransaction: string, requestId: string): Promise<JupExecute> {
  const ex = await executeOrder(signedTransaction, requestId);
  if (ex.status === 'Success' && ex.signature) return ex;
  const detail = `${describeExecute(ex.code)} (code ${ex.code})${ex.error ? `: ${ex.error}` : ''}`;
  if (RETRYABLE_EXECUTE.has(ex.code)) {
    throw new Error(`jupiter /execute retryable: ${detail}`);
  }
  throw new Error(`jupiter /execute failed: ${detail}`);
}
