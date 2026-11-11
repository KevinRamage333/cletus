/**
 * Owner-only withdrawal from the operator trading wallet (the key the worker holds on the box).
 * Flow: preview (validate address + amount, optional "close all positions") -> signed one-time confirmation token
 * (2 min) -> confirm with the typed word WITHDRAW -> execute. In simulation mode NOTHING is sent: the request is
 * validated and recorded as `simulated`. Live sends also need WITHDRAW_LIVE_ENABLED=true. Every attempt is logged.
 * Pure helpers are exported for tests; side effects are injected via WithdrawDeps.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { BLOCKED_DESTINATIONS, LAMPORTS_PER_SOL, validateDestination, type DestResult } from './solana-address';
export { BLOCKED_DESTINATIONS, LAMPORTS_PER_SOL, validateDestination, type DestResult };

export const BASE_FEE_LAMPORTS = 5_000;
export const RENT_EXEMPT_MIN_LAMPORTS = 890_880;           // 0-data system account
export const CONFIRM_WORD = 'WITHDRAW';
export const TOKEN_TTL_MS = 2 * 60_000;

export function reserveLamports(env: Record<string, string | undefined> = process.env): number {
  const sol = Number(env.WITHDRAW_FEE_RESERVE_SOL ?? 0.002);
  const l = Math.round((Number.isFinite(sol) && sol >= 0 ? sol : 0.002) * LAMPORTS_PER_SOL);
  return Math.max(l, RENT_EXEMPT_MIN_LAMPORTS + BASE_FEE_LAMPORTS);
}


export type AmountResult = { ok: true; lamports: number; remainingLamports: number; feeLamports: number } | { ok: false; error: string };
/** amountSol > 0, or max=true for (balance − reserve). The wallet always keeps `reserve` (≥ rent-exempt minimum + fee). */
export function computeSend(o: { balanceLamports: number; amountSol?: number | null; max?: boolean; reserveLamports: number }): AmountResult {
  const bal = Math.floor(o.balanceLamports);
  if (!Number.isFinite(bal) || bal < 0) return { ok: false, error: 'Wallet balance unknown' };
  const spendable = bal - o.reserveLamports;
  if (spendable <= 0) return { ok: false, error: `Balance ${(bal / LAMPORTS_PER_SOL).toFixed(6)} SOL is at or below the ${(o.reserveLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL fee reserve` };
  let lamports: number;
  if (o.max) lamports = spendable;
  else {
    const a = Number(o.amountSol);
    if (!Number.isFinite(a) || a <= 0) return { ok: false, error: 'Enter an amount greater than 0, or choose Max' };
    lamports = Math.round(a * LAMPORTS_PER_SOL);
    if (lamports < 1) return { ok: false, error: 'Amount is too small' };
    if (lamports > spendable) return { ok: false, error: `Max you can send is ${(spendable / LAMPORTS_PER_SOL).toFixed(6)} SOL (keeps the fee reserve)` };
  }
  return { ok: true, lamports, remainingLamports: bal - lamports - BASE_FEE_LAMPORTS, feeLamports: BASE_FEE_LAMPORTS };
}

export interface WithdrawPlan { uid: string; to: string; lamports: number; max: boolean; closePositions: boolean; mode: 'simulation' | 'live'; exp: number; nonce: string }
const b64u = (b: Buffer) => b.toString('base64url');
const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest();

export function issueToken(p: Omit<WithdrawPlan, 'exp' | 'nonce'>, secret: string, now = Date.now()): string {
  const plan: WithdrawPlan = { ...p, exp: now + TOKEN_TTL_MS, nonce: b64u(randomBytes(12)) };
  const body = b64u(Buffer.from(JSON.stringify(plan)));
  return `${body}.${b64u(sign(body, secret))}`;
}

const g = globalThis as unknown as { __wdUsed?: Map<string, number>; __wdLast?: Map<string, number> };
const used = (g.__wdUsed ??= new Map());
export function verifyToken(token: unknown, secret: string, uid: string, now = Date.now(), usedNonces: Map<string, number> = used): { ok: true; plan: WithdrawPlan } | { ok: false; error: string } {
  const [body, sig] = String(token ?? '').split('.');
  if (!body || !sig) return { ok: false, error: 'Missing confirmation token; preview again' };
  const want = sign(body, secret); const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, error: 'Confirmation token is invalid; preview again' };
  let plan: WithdrawPlan;
  try { plan = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, error: 'Confirmation token is corrupt' }; }
  if (plan.uid !== uid) return { ok: false, error: 'Confirmation token belongs to another user' };
  if (now > plan.exp) return { ok: false, error: 'Confirmation expired (2 minutes); preview again' };
  for (const [n, exp] of usedNonces) if (exp < now) usedNonces.delete(n);
  if (usedNonces.has(plan.nonce)) return { ok: false, error: 'This confirmation was already used' };
  usedNonces.set(plan.nonce, plan.exp);
  return { ok: true, plan };
}

export interface WithdrawDeps {
  liveEnabled: boolean;
  ownAddress: string;
  getBalanceLamports: () => Promise<number>;
  closeAllPositions: () => Promise<number>;            // returns how many were closed
  sendTransfer: (to: string, lamports: number) => Promise<string>;   // returns signature (live only)
  log: (level: 'info' | 'warn' | 'error' | 'trade', msg: string) => Promise<void>;
  record: (r: { to: string; lamports: number; mode: string; status: string; signature?: string | null; closedPositions: number; error?: string | null }) => Promise<void>;
}
export interface WithdrawResult { status: 'simulated' | 'sent' | 'failed' | 'refused'; signature: string | null; lamports: number; closedPositions: number; message: string }

const sol = (l: number) => `${(l / LAMPORTS_PER_SOL).toFixed(6)} SOL`;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export async function executeWithdraw(plan: WithdrawPlan, d: WithdrawDeps, reserve: number): Promise<WithdrawResult> {
  const dest = validateDestination(plan.to, d.ownAddress);
  if (!dest.ok) return refuse(dest.error);
  if (plan.mode === 'live' && !d.liveEnabled) return refuse('Live withdrawals are disabled (set WITHDRAW_LIVE_ENABLED=true on the worker)');

  let closed = 0;
  if (plan.closePositions) {
    closed = await d.closeAllPositions();
    await d.log('info', `withdraw: closed ${closed} open position(s) before withdrawal (${plan.mode})`);
  }
  const bal = await d.getBalanceLamports();
  // Re-check against the balance NOW (positions may have closed; balance may have moved). Max is recomputed.
  const amt = computeSend({ balanceLamports: bal, max: plan.max, amountSol: plan.lamports / LAMPORTS_PER_SOL, reserveLamports: reserve });
  if (!amt.ok) return refuse(amt.error, closed);

  if (plan.mode === 'simulation') {
    const msg = `SIMULATED withdrawal of ${sol(amt.lamports)} to ${short(dest.address)}; no transaction sent (simulation mode)`;
    await d.log('trade', `withdraw: ${msg}`);
    await d.record({ to: dest.address, lamports: amt.lamports, mode: 'simulation', status: 'simulated', closedPositions: closed });
    return { status: 'simulated', signature: null, lamports: amt.lamports, closedPositions: closed, message: msg };
  }
  try {
    await d.log('warn', `withdraw: LIVE sending ${sol(amt.lamports)} to ${short(dest.address)}`);
    const sig = await d.sendTransfer(dest.address, amt.lamports);
    await d.log('trade', `withdraw: LIVE sent ${sol(amt.lamports)} to ${short(dest.address)} sig ${sig}`);
    await d.record({ to: dest.address, lamports: amt.lamports, mode: 'live', status: 'sent', signature: sig, closedPositions: closed });
    return { status: 'sent', signature: sig, lamports: amt.lamports, closedPositions: closed, message: `Sent ${sol(amt.lamports)} to ${short(dest.address)}` };
  } catch (e) {
    const err = (e as Error).message.slice(0, 300);
    await d.log('error', `withdraw: LIVE send failed: ${err}`);
    await d.record({ to: dest.address, lamports: amt.lamports, mode: 'live', status: 'failed', closedPositions: closed, error: err });
    return { status: 'failed', signature: null, lamports: amt.lamports, closedPositions: closed, message: `Send failed: ${err}` };
  }

  async function refuse(error: string, closedPositions = 0): Promise<WithdrawResult> {
    await d.log('warn', `withdraw refused: ${error}`);
    await d.record({ to: String(plan.to), lamports: plan.lamports, mode: plan.mode, status: 'refused', closedPositions, error });
    return { status: 'refused', signature: null, lamports: 0, closedPositions, message: error };
  }
}

/** Per-user cooldown between confirmed withdrawals (default 30 s). */
export function cooldownOk(uid: string, now = Date.now(), ms = 30_000, last: Map<string, number> = (g.__wdLast ??= new Map())): boolean {
  const t = last.get(uid) ?? 0;
  if (now - t < ms) return false;
  last.set(uid, now);
  return true;
}
