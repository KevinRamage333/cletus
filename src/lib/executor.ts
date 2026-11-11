/**
 * LIVE execution via Jupiter Swap API V2 (/order + /execute). Only ever called when config.mode === 'live'
 * for the operator account. Simulation mode never imports a signer.
 */
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { loadTradingKeypair } from './wallet';
import type { Config } from './config';
import { activeRpc } from './rpc-pool';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface SwapRequest { inputMint: string; outputMint: string; amountRaw: bigint; slippageBps: number; priorityFeeLamports: number }
export interface SwapResult { signature: string; inAmount: string; outAmount: string; feeBps?: number; router?: string }

let conn: Connection | null = null;
let connUrl = '';
/** Connection to the currently active RPC (Helius primary, FluxRPC backup; see rpc-pool.ts). */
export function connection(cfg: Config) {
  const url = activeRpc()?.url ?? cfg.rpcUrl;
  if (!conn || url !== connUrl) { conn = new Connection(url, 'confirmed'); connUrl = url; }
  return conn;
}

/**
 * LIVE swap via Jupiter Swap API V2 Meta-Aggregator: GET /order (taker = operator wallet, fixed slippageBps for
 * deterministic bot behaviour) -> sign -> POST /execute (Jupiter lands it: RTSE, priority fees, Beam, confirmation).
 * When a Jupiter referral account is configured and the taker should be charged, /order is called with
 * referralAccount + referralFee (default 50 bps). Owner trades matching OPERATOR_FEE_WALLET are skipped unless
 * OPERATOR_FEE_ON_OWNER=true. `transaction: ""` responses and /execute error codes are surfaced; retryable
 * /execute codes get one fresh order.
 */
export async function executeSwap(cfg: Config, r: SwapRequest): Promise<SwapResult> {
  if (cfg.mode !== 'live') throw new Error('executeSwap called outside live mode');
  const { getOrder, executeOrder, orderTxProblem, describeExecute, RETRYABLE_EXECUTE } = await import('./jupiter');
  const kp = loadTradingKeypair();
  const taker = kp.publicKey.toBase58();
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    const order = await getOrder({ inputMint: r.inputMint, outputMint: r.outputMint, amount: r.amountRaw, taker, slippageBps: r.slippageBps });
    const problem = orderTxProblem(order, true);
    if (problem) throw new Error(`jupiter /order: ${problem}`);
    const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction!, 'base64'));
    tx.sign([kp]);                                     // our signature only; JupiterZ market makers co-sign in /execute
    const ex = await executeOrder(Buffer.from(tx.serialize()).toString('base64'), order.requestId);
    if (ex.status === 'Success' && ex.signature) {
      return { signature: ex.signature, inAmount: ex.totalInputAmount ?? order.inAmount, outAmount: ex.totalOutputAmount ?? order.outAmount, feeBps: order.feeBps, router: order.router };
    }
    lastErr = `${describeExecute(ex.code)} (code ${ex.code})${ex.signature ? ` sig ${ex.signature}` : ''}${ex.error ? `: ${ex.error}` : ''}`;
    if (!RETRYABLE_EXECUTE.has(ex.code)) break;
  }
  throw new Error(`jupiter /execute failed: ${lastErr}`);
}

/** Raw on-chain balance of `mint` held by the operator wallet. */
export async function tokenBalanceRaw(cfg: Config, mint: string): Promise<{ raw: bigint; decimals: number }> {
  const kp = loadTradingKeypair();
  const res = await connection(cfg).getParsedTokenAccountsByOwner(kp.publicKey, { mint: new PublicKey(mint) });
  let raw = 0n, decimals = 6;
  for (const a of res.value) {
    const info = a.account.data.parsed.info.tokenAmount;
    raw += BigInt(info.amount);
    decimals = info.decimals;
  }
  return { raw, decimals };
}

export async function solBalance(cfg: Config, pubkey: string): Promise<number | null> {
  try {
    return (await connection(cfg).getBalance(new PublicKey(pubkey))) / 1e9;
  } catch {
    return null;
  }
}
