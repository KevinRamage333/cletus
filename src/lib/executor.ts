/**
 * LIVE execution via Jupiter Swap API V2 (/order + /execute). Only ever called when config.mode === 'live'
 * for the operator account. Simulation mode never imports a signer.
 */
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { loadTradingKeypair } from './wallet';
import type { Config } from './config';
import { activeRpc } from './rpc-pool';
import { timedFetch } from './watchdog';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface SwapRequest { inputMint: string; outputMint: string; amountRaw: bigint; slippageBps: number; priorityFeeLamports: number }
export interface SwapResult { signature: string; inAmount: string; outAmount: string; feeBps?: number; router?: string }

let conn: Connection | null = null;
let connUrl = '';
/** Per-request RPC timeout (ms). web3.js has none by default, so one stuck request could freeze a tick. */
export const rpcTimeoutMs = () => { const v = Number(process.env.RPC_REQUEST_TIMEOUT_MS); return Number.isFinite(v) && v > 0 ? v : 15_000; };
/** Connection to the currently active RPC (Helius primary, FluxRPC backup; see rpc-pool.ts). Every request times out. */
export function connection(cfg: Config) {
  const url = activeRpc()?.url ?? cfg.rpcUrl;
  if (!conn || url !== connUrl) { conn = new Connection(url, { commitment: 'confirmed', fetch: timedFetch(rpcTimeoutMs()) as never }); connUrl = url; }
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
  // Mark the wallet as busy so the live drawdown tracker treats the SOL change as trading, not a deposit.
  const { withBotTx } = await import('./live-drawdown');
  return withBotTx(() => executeSwapInner(cfg, r));
}

async function executeSwapInner(cfg: Config, r: SwapRequest): Promise<SwapResult> {
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
    // PRIVATE_ROUTE (default off) = plain Jupiter /execute; see private-route.ts for the optional Jito bundle path.
    const { submitSwap } = await import('./private-route');
    const ex = await submitSwap({ order, signedTx: tx, kp, execute: executeOrder });
    if (ex.status === 'Success' && ex.signature) {
      if (ex.route !== 'jupiter') console.log(`[cletus] swap landed via ${ex.route}`);
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

/** Decimals of an SPL mint, read from the mint account; null if unreadable. */
export async function mintDecimals(cfg: Config, mint: string): Promise<number | null> {
  try {
    const info = await connection(cfg).getParsedAccountInfo(new PublicKey(mint));
    const d = (info.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)?.parsed?.info?.decimals;
    return typeof d === 'number' && Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}
