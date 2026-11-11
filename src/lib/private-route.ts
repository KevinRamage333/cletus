/**
 * Optional private routing for LIVE swaps via a Jito bundle (flag PRIVATE_ROUTE, default off).
 *
 * Today every live swap goes Jupiter /order -> sign -> Jupiter /execute, which already lands through Jupiter Beam
 * (Jupiter's own validator stake, private until execution). This module adds a second, opt-in path:
 *   PRIVATE_ROUTE=off     (default) unchanged: Jupiter /execute only.
 *   PRIVATE_ROUTE=dryrun  unchanged execution, plus a non-blocking dry run of the bundle path: build the tip tx, simulate
 *                         swap + tip on the RPC (simulateTransaction, nothing is sent), read Jito's tip floor, log the result.
 *   PRIVATE_ROUTE=jito    send [signed swap, tip transfer] as a Jito bundle (atomic: the tip is only paid if the swap lands),
 *                         then hand the SAME signed transaction to Jupiter /execute, which lands it if the bundle didn't, or
 *                         reports the already-landed signature (same signature: it cannot execute twice). Requires
 *                         PRIVATE_ROUTE_BROADCAST=true as a second switch; without it `jito` behaves like `dryrun`.
 * Only aggregator orders are eligible: JupiterZ RFQ (market maker co-signs inside /execute) and gasless orders always use /execute.
 * Tip: JITO_TIP_LAMPORTS (default 10,000 = Jito's recent median landed tip) capped by PRIVATE_ROUTE_MAX_TIP_LAMPORTS
 * (default 20,000), never above HARD_MAX_TIP_LAMPORTS (100,000 = 0.0001 SOL), never below Jito's 1,000 minimum.
 */
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type Keypair } from '@solana/web3.js';
import type { JupExecute, JupOrder } from './jupiter';

export type PrivateRouteMode = 'off' | 'dryrun' | 'jito';
export const JITO_MIN_TIP_LAMPORTS = 1_000;
export const HARD_MAX_TIP_LAMPORTS = 100_000;
/** Jito mainnet tip accounts (getTipAccounts, checked 2026-11-11). */
export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5', 'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe', 'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY', 'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh', 'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt', 'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL', '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

export interface PrivateRouteConfig { mode: PrivateRouteMode; requested: PrivateRouteMode; blockEngineUrl: string; tipLamports: number; landTimeoutMs: number; note: string | null }

export function capTip(requested: number, max: number): number {
  const m = Math.min(HARD_MAX_TIP_LAMPORTS, Number.isFinite(max) && max > 0 ? max : 20_000);
  const r = Number.isFinite(requested) && requested > 0 ? requested : 10_000;
  return Math.max(JITO_MIN_TIP_LAMPORTS, Math.min(Math.round(r), m));
}

export function privateRouteConfig(env: Record<string, string | undefined> = process.env): PrivateRouteConfig {
  const v = (env.PRIVATE_ROUTE ?? '').trim().toLowerCase();
  const requested: PrivateRouteMode = v === 'dryrun' || v === 'jito' ? v : 'off';
  const broadcast = (env.PRIVATE_ROUTE_BROADCAST ?? '').trim().toLowerCase() === 'true';
  const mode: PrivateRouteMode = requested === 'jito' && !broadcast ? 'dryrun' : requested;
  const n = (k: string, d: number) => { const x = Number(env[k]); return Number.isFinite(x) && x > 0 ? x : d; };
  return {
    mode, requested,
    blockEngineUrl: (env.JITO_BLOCK_ENGINE_URL || 'https://mainnet.block-engine.jito.wtf').replace(/\/$/, ''),
    tipLamports: capTip(n('JITO_TIP_LAMPORTS', 10_000), n('PRIVATE_ROUTE_MAX_TIP_LAMPORTS', 20_000)),
    landTimeoutMs: Math.min(30_000, n('PRIVATE_ROUTE_LAND_TIMEOUT_MS', 6_000)),
    note: requested === 'jito' && !broadcast ? 'PRIVATE_ROUTE=jito without PRIVATE_ROUTE_BROADCAST=true: dry run only' : null,
  };
}

/** Why an order can't go through a bundle (null = eligible). Pure. */
export function bundleIneligible(o: Pick<JupOrder, 'router' | 'gasless' | 'transaction'>): string | null {
  if (o.router === 'jupiterz') return 'JupiterZ RFQ order needs /execute (market maker co-signs)';
  if (o.gasless) return 'gasless order needs /execute';
  if (!o.transaction) return 'no transaction';
  return null;
}

export const pickTipAccount = (rand: () => number = Math.random) => JITO_TIP_ACCOUNTS[Math.min(JITO_TIP_ACCOUNTS.length - 1, Math.floor(rand() * JITO_TIP_ACCOUNTS.length))];

/** Signed SOL transfer to a Jito tip account, on the swap's blockhash so both expire together. */
export function buildTipTx(kp: Keypair, recentBlockhash: string, tipAccount: string, lamports: number): VersionedTransaction {
  const msg = new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash, instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(tipAccount), lamports })] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([kp]);
  return tx;
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Base58 (for the swap signature). Pure. */
export function base58(bytes: Uint8Array): string {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
  return s;
}

export const bundleRequest = (method: 'sendBundle' | 'getInflightBundleStatuses', params: unknown[]) => ({ jsonrpc: '2.0', id: 1, method, params });

export interface RouteDeps {
  fetch?: typeof fetch;
  rpc?: <T>(method: string, params: unknown, opts?: { timeoutMs?: number }) => Promise<T>;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  env?: Record<string, string | undefined>;
  rand?: () => number;
}
const defaults = (d: RouteDeps) => ({
  fetch: d.fetch ?? fetch,
  rpc: d.rpc ?? (async <T>(m: string, p: unknown, o?: { timeoutMs?: number }) => (await import('./rpc-pool')).rpcCall<T>(m, p, o)),
  sleep: d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  log: d.log ?? ((m: string) => console.log(`[cletus] ${m}`)),
  env: d.env ?? process.env,
  rand: d.rand ?? Math.random,
});

async function postJson<T>(f: typeof fetch, url: string, body: unknown, timeoutMs: number): Promise<T> {
  const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json() as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? 'jito error');
  return j.result as T;
}

export interface DryRunResult { tipLamports: number; tipAccount: string; swapSim: string; tipSim: string; tipFloorP50Lamports: number | null; eligible: boolean; reason: string | null }

/** Simulate the bundle path without sending anything. Never throws. */
export async function dryRunBundle(order: Pick<JupOrder, 'router' | 'gasless' | 'transaction'>, signedSwap: VersionedTransaction, kp: Keypair, deps: RouteDeps = {}): Promise<DryRunResult> {
  const d = defaults(deps); const cfg = privateRouteConfig(d.env);
  const tipAccount = pickTipAccount(d.rand);
  const reason = bundleIneligible(order);
  const out: DryRunResult = { tipLamports: cfg.tipLamports, tipAccount, swapSim: 'skipped', tipSim: 'skipped', tipFloorP50Lamports: null, eligible: !reason, reason };
  const sim = async (tx: VersionedTransaction) => {
    try {
      const r = await d.rpc<{ value: { err: unknown; unitsConsumed?: number } }>('simulateTransaction', [Buffer.from(tx.serialize()).toString('base64'), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'processed' }], { timeoutMs: 5000 });
      return r.value.err ? `err ${JSON.stringify(r.value.err).slice(0, 80)}` : `ok (${r.value.unitsConsumed ?? '?'} CU)`;
    } catch (e) { return `rpc error ${(e as Error).message.slice(0, 60)}`; }
  };
  try {
    const tipTx = buildTipTx(kp, signedSwap.message.recentBlockhash, tipAccount, cfg.tipLamports);
    [out.swapSim, out.tipSim] = await Promise.all([sim(signedSwap), sim(tipTx)]);
  } catch (e) { out.tipSim = `build error ${(e as Error).message.slice(0, 60)}`; }
  try {
    const r = await d.fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor', { signal: AbortSignal.timeout(3000) });
    const j = await r.json() as Array<{ landed_tips_50th_percentile?: number }>;
    const p50 = j?.[0]?.landed_tips_50th_percentile;
    if (typeof p50 === 'number') out.tipFloorP50Lamports = Math.round(p50 * 1e9);
  } catch { /* informational only */ }
  return out;
}

export interface SubmitArgs { order: JupOrder; signedTx: VersionedTransaction; kp: Keypair; execute: (signedB64: string, requestId: string) => Promise<JupExecute> }
export type RoutedExecute = JupExecute & { route: 'jupiter' | 'jito' | 'jupiter_fallback' };

/**
 * Submit a signed Jupiter swap. Off / dryrun: Jupiter /execute (dry run runs alongside, never delays the swap).
 * jito (+ broadcast): bundle first, then /execute with the same signed tx for the canonical result or the fallback landing.
 */
export async function submitSwap(a: SubmitArgs, deps: RouteDeps = {}): Promise<RoutedExecute> {
  const d = defaults(deps); const cfg = privateRouteConfig(d.env);
  const b64 = Buffer.from(a.signedTx.serialize()).toString('base64');
  if (cfg.mode === 'off') return { ...(await a.execute(b64, a.order.requestId)), route: 'jupiter' };
  if (cfg.mode === 'dryrun') {
    void dryRunBundle(a.order, a.signedTx, a.kp, deps).then((r) => d.log(`private route dry run (nothing sent): ${r.eligible ? 'eligible' : `not eligible: ${r.reason}`}; would tip ${r.tipLamports} lamports to ${r.tipAccount.slice(0, 6)}…; swap sim ${r.swapSim}; tip sim ${r.tipSim}; Jito median landed tip ${r.tipFloorP50Lamports ?? '?'} lamports${cfg.note ? `; ${cfg.note}` : ''}`)).catch(() => undefined);
    return { ...(await a.execute(b64, a.order.requestId)), route: 'jupiter' };
  }
  // mode === 'jito' (broadcast explicitly enabled)
  const reason = bundleIneligible(a.order);
  if (reason) return { ...(await a.execute(b64, a.order.requestId)), route: 'jupiter' };
  const sig = base58(a.signedTx.signatures[0]);
  let bundleId: string | null = null; let landed = false;
  try {
    const tip = buildTipTx(a.kp, a.signedTx.message.recentBlockhash, pickTipAccount(d.rand), cfg.tipLamports);
    bundleId = await postJson<string>(d.fetch, `${cfg.blockEngineUrl}/api/v1/bundles`, bundleRequest('sendBundle', [[b64, Buffer.from(tip.serialize()).toString('base64')], { encoding: 'base64' }]), 3000);
    const until = Date.now() + cfg.landTimeoutMs;
    while (Date.now() < until) {
      await d.sleep(500);
      const st = await postJson<{ value: Array<{ status: string }> }>(d.fetch, `${cfg.blockEngineUrl}/api/v1/getInflightBundleStatuses`, bundleRequest('getInflightBundleStatuses', [[bundleId]]), 3000).catch(() => null);
      const s = st?.value?.[0]?.status;
      if (s === 'Landed') { landed = true; break; }
      if (s === 'Failed' || s === 'Invalid') break;
    }
  } catch (e) { d.log(`Jito bundle not sent (${(e as Error).message.slice(0, 80)}); falling back to Jupiter /execute`); }
  // Same signed tx: Jupiter either lands it now or reports the already-landed signature. It cannot execute twice.
  const ex = await a.execute(b64, a.order.requestId);
  if (ex.status === 'Success') return { ...ex, route: landed ? 'jito' : 'jupiter_fallback' };
  if (landed) {
    // Bundle landed but /execute didn't confirm it: trust the chain, never re-order (that would double-trade).
    const s = await d.rpc<{ value: Array<{ err: unknown; confirmationStatus?: string } | null> }>('getSignatureStatuses', [[sig], { searchTransactionHistory: false }], { timeoutMs: 5000 }).catch(() => null);
    const v = s?.value?.[0];
    if (v && !v.err) return { status: 'Success', signature: sig, code: 0, totalInputAmount: null, totalOutputAmount: null, inputAmountResult: null, outputAmountResult: null, error: null, route: 'jito' };
  }
  // Landed per Jito but unconfirmed: a non-retryable failure so the executor never builds a second order for it.
  if (landed) return { ...ex, code: -9001, error: `Jito reported bundle ${bundleId} landed but the signature is unconfirmed; not retrying`, route: 'jito' };
  return { ...ex, route: bundleId ? 'jupiter_fallback' : 'jupiter' };
}
