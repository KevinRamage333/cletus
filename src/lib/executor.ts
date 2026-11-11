/**
 * LIVE execution via Jupiter. Only ever called when config.mode === 'live'
 * for the operator account. Simulation mode never imports a signer.
 */
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { loadTradingKeypair } from './wallet';
import type { Config } from './config';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface SwapRequest { inputMint: string; outputMint: string; amountRaw: bigint; slippageBps: number; priorityFeeLamports: number }
export interface SwapResult { signature: string; inAmount: string; outAmount: string }

let conn: Connection | null = null;
export function connection(cfg: Config) {
  if (!conn) conn = new Connection(cfg.rpcUrl, 'confirmed');
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
  const sRes = await fetch(`${cfg.jupiterBaseUrl}/swap`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: kp.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: r.priorityFeeLamports,
    }),
  });
  if (!sRes.ok) throw new Error(`jupiter swap HTTP ${sRes.status}`);
  const { swapTransaction, lastValidBlockHeight } = await sRes.json();
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([kp]);
  const c = connection(cfg);
  const signature = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
  const conf = await Promise.race([
    c.confirmTransaction({ signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight }, 'confirmed'),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('transaction not confirmed: timeout')), cfg.txConfirmationTimeoutSec * 1000)),
  ]);
  if (conf.value.err) throw new Error(`transaction failed: ${JSON.stringify(conf.value.err)}`);
  return { signature, inAmount: quote.inAmount, outAmount: quote.outAmount };
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
