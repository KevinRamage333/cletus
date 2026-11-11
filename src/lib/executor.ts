/**
 * LIVE execution via Jupiter. Only ever called when config.mode === 'live'
 * for the operator account. Simulation mode never imports a signer.
 */
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { loadTradingKeypair } from './wallet';
import type { Config } from './config';
import { submissionPlan } from './submission';
import { activeRpc } from './rpc-pool';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface SwapRequest { inputMint: string; outputMint: string; amountRaw: bigint; slippageBps: number; priorityFeeLamports: number }
export interface SwapResult { signature: string; inAmount: string; outAmount: string }

let conn: Connection | null = null;
let connUrl = '';
/** Connection to the currently active RPC (Helius primary, FluxRPC backup; see rpc-pool.ts). */
export function connection(cfg: Config) {
  const url = activeRpc()?.url ?? cfg.rpcUrl;
  if (!conn || url !== connUrl) { conn = new Connection(url, 'confirmed'); connUrl = url; }
  return conn;
}

export async function executeSwap(cfg: Config, r: SwapRequest): Promise<SwapResult> {
  if (cfg.mode !== 'live') throw new Error('executeSwap called outside live mode');
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(cfg.jupiterApiKey ? { 'x-api-key': cfg.jupiterApiKey } : {}) };
  const qUrl = `${cfg.jupiterBaseUrl}/quote?inputMint=${r.inputMint}&outputMint=${r.outputMint}&amount=${r.amountRaw}&slippageBps=${r.slippageBps}`;
  const qRes = await fetch(qUrl, { headers, signal: AbortSignal.timeout(10000) });
  if (!qRes.ok) throw new Error(`jupiter quote HTTP ${qRes.status}`);
  const quote = await qRes.json();
  if (!quote?.outAmount) throw new Error('jupiter: no route');

  const kp = loadTradingKeypair();
  const plan = submissionPlan(cfg, r.priorityFeeLamports);
  const sRes = await fetch(`${cfg.jupiterBaseUrl}/swap`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: kp.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: plan.prioritization,
    }),
  });
  if (!sRes.ok) throw new Error(`jupiter swap HTTP ${sRes.status}`);
  const { swapTransaction, lastValidBlockHeight } = await sRes.json();
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([kp]);
  const c = connection(cfg);
  const signature = await sendSigned(cfg, plan, tx.serialize());
  const conf = await Promise.race([
    c.confirmTransaction({ signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight }, 'confirmed'),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('transaction not confirmed: timeout')), cfg.txConfirmationTimeoutSec * 1000)),
  ]);
  if (conf.value.err) throw new Error(`transaction failed: ${JSON.stringify(conf.value.err)}`);
  return { signature, inAmount: quote.inAmount, outAmount: quote.outAmount };
}

/** Submit a signed transaction via the configured path (standard RPC, private RPC, or Jito block engine). */
async function sendSigned(cfg: Config, plan: ReturnType<typeof submissionPlan>, raw: Uint8Array): Promise<string> {
  if (plan.mode === 'standard') return connection(cfg).sendRawTransaction(raw, { skipPreflight: plan.skipPreflight, maxRetries: 2 });
  if (plan.mode === 'private_rpc') return new Connection(plan.sendUrl, 'confirmed').sendRawTransaction(raw, { skipPreflight: plan.skipPreflight, maxRetries: 2 });
  const res = await fetch(plan.sendUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [Buffer.from(raw).toString('base64'), { encoding: 'base64' }] }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error || !j.result) throw new Error(`jito send failed: ${j.error?.message ?? `HTTP ${res.status}`}`);
  return j.result as string;
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
