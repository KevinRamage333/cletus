/**
 * Owner real-withdrawal queue.
 *
 * Flow: the owner (SIWS session) previews a withdrawal on the site, then types
 * WITHDRAW to confirm. The site only records a *confirmed request* in the owner
 * state that already syncs box ↔ Vercel. The site never signs or sends.
 *
 * The box worker pulls the request and executes it only when ALL of these hold:
 *  - OWNER_REMOTE_WITHDRAW=on on the worker (off by default; never on in tests)
 *  - destination is on OWNER_WITHDRAW_ALLOWLIST (comma list, box env)
 *  - today's sent total + this amount stays within OWNER_WITHDRAW_DAILY_CAP_SOL
 *  - the request has not expired (15 min) and was never attempted before
 *    (a local ledger entry is written *before* sending, so no double sends)
 * Every decision is logged and pushed back to the site as the request status.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { PublicKey } from '@solana/web3.js';

export const KOL_TRADING_WALLET = '4pRMrg37MfkKgoawxFpjECLC5LTGbvc22yKFCh9mPPe3';
export const REQUEST_TTL_MS = 15 * 60_000;
export const LAMPORTS = 1_000_000_000;

export type WithdrawWallet = 'main' | 'kol';
export type RequestStatus = 'confirmed' | 'executing' | 'sent' | 'refused' | 'failed' | 'expired';

export interface OwnerWithdrawRequest {
  id: string;
  wallet: WithdrawWallet;
  to: string;
  lamports: number;
  by: string;
  createdAt: string;
  status: RequestStatus;
  updatedAt: string;
  signature?: string | null;
  note?: string | null;
}

const RANK: Record<RequestStatus, number> = { confirmed: 0, executing: 1, sent: 2, refused: 2, failed: 2, expired: 2 };
export const isTerminal = (s: RequestStatus) => RANK[s] === 2;

export function isSolAddress(a: string): boolean {
  try { return new PublicKey(a).toBase58() === a; } catch { return false; }
}

export function parseAllowlist(env: Record<string, string | undefined> = process.env): string[] {
  return (env.OWNER_WITHDRAW_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(isSolAddress);
}

export function dailyCapLamports(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.OWNER_WITHDRAW_DAILY_CAP_SOL ?? '0.5');
  return Number.isFinite(n) && n > 0 ? Math.round(n * LAMPORTS) : 0;
}

export function remoteWithdrawEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL || env.VITEST === 'true' || env.NODE_ENV === 'test') return false;
  return (env.OWNER_REMOTE_WITHDRAW ?? '').trim().toLowerCase() === 'on';
}

/** Merge two request lists by id; the more advanced status wins (never regress). */
export function mergeRequests(a: OwnerWithdrawRequest[] = [], b: OwnerWithdrawRequest[] = []): OwnerWithdrawRequest[] {
  const m = new Map<string, OwnerWithdrawRequest>();
  for (const r of [...a, ...b]) {
    if (!r || typeof r.id !== 'string') continue;
    const have = m.get(r.id);
    if (!have || RANK[r.status] > RANK[have.status]) m.set(r.id, r);
  }
  return [...m.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt)).slice(-50);
}

export function newRequest(o: { wallet: WithdrawWallet; to: string; amountSol: number; by: string }, now = Date.now()):
  { ok: true; request: OwnerWithdrawRequest } | { ok: false; error: string } {
  if (o.wallet !== 'main' && o.wallet !== 'kol') return { ok: false, error: 'wallet must be main or kol' };
  if (!isSolAddress(o.to)) return { ok: false, error: 'destination is not a valid Solana address' };
  const lamports = Math.round(Number(o.amountSol) * LAMPORTS);
  if (!Number.isFinite(lamports) || lamports <= 0) return { ok: false, error: 'amount must be > 0' };
  const iso = new Date(now).toISOString();
  const id = `wd_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return { ok: true, request: { id, wallet: o.wallet, to: o.to, lamports, by: o.by, createdAt: iso, updatedAt: iso, status: 'confirmed' } };
}

export function sentTodayLamports(ledger: OwnerWithdrawRequest[], now = Date.now()): number {
  const day = new Date(now).toISOString().slice(0, 10);
  // executing counts too: an attempt that crashed mid-send may still have gone out.
  return ledger.filter((r) => (r.status === 'sent' || r.status === 'executing') && r.updatedAt.slice(0, 10) === day)
    .reduce((s, r) => s + r.lamports, 0);
}

export type Decision = { execute: true } | { execute: false; status: 'refused' | 'expired'; reason: string };

/** Pure gate the worker runs before any send. */
export function decide(req: OwnerWithdrawRequest, ctx: { enabled: boolean; allowlist: string[]; capLamports: number; ledger: OwnerWithdrawRequest[]; now?: number }): Decision {
  const now = ctx.now ?? Date.now();
  if (ctx.ledger.some((r) => r.id === req.id)) return { execute: false, status: 'refused', reason: 'already attempted on this worker' };
  if (now - Date.parse(req.createdAt) > REQUEST_TTL_MS) return { execute: false, status: 'expired', reason: 'request expired before the worker picked it up' };
  if (!ctx.enabled) return { execute: false, status: 'refused', reason: 'remote withdrawals are off on the worker (OWNER_REMOTE_WITHDRAW)' };
  if (!ctx.allowlist.includes(req.to)) return { execute: false, status: 'refused', reason: 'destination is not on the owner allowlist' };
  if (ctx.capLamports <= 0) return { execute: false, status: 'refused', reason: 'daily cap is not set' };
  const used = sentTodayLamports(ctx.ledger, now);
  if (used + req.lamports > ctx.capLamports) {
    return { execute: false, status: 'refused', reason: `daily cap ${(ctx.capLamports / LAMPORTS).toFixed(3)} SOL would be exceeded (used ${(used / LAMPORTS).toFixed(3)})` };
  }
  return { execute: true };
}

// ── box-side ledger ─────────────────────────────────────────────────────────
export function ledgerPath(env: Record<string, string | undefined> = process.env): string {
  return resolve(env.OWNER_WITHDRAW_LEDGER_PATH || 'data/owner-withdrawals.json');
}
export function readLedger(path = ledgerPath()): OwnerWithdrawRequest[] {
  try { return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as OwnerWithdrawRequest[]) : []; } catch { return []; }
}
export function writeLedger(rows: OwnerWithdrawRequest[], path = ledgerPath()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(rows.slice(-500), null, 1), { mode: 0o600 });
}

export interface ExecDeps {
  enabled: boolean;
  allowlist: string[];
  capLamports: number;
  readLedger: () => OwnerWithdrawRequest[];
  writeLedger: (rows: OwnerWithdrawRequest[]) => void;
  send: (wallet: WithdrawWallet, to: string, lamports: number) => Promise<string>;
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
  now?: () => number;
}

/** Process every confirmed request once. Returns the updated requests (to push back). */
export async function processRequests(reqs: OwnerWithdrawRequest[], d: ExecDeps): Promise<OwnerWithdrawRequest[]> {
  const out: OwnerWithdrawRequest[] = [];
  for (const req of reqs) {
    if (req.status !== 'confirmed') continue;
    const now = d.now?.() ?? Date.now();
    const ledger = d.readLedger();
    const dec = decide(req, { enabled: d.enabled, allowlist: d.allowlist, capLamports: d.capLamports, ledger, now });
    const iso = new Date(now).toISOString();
    const sol = (req.lamports / LAMPORTS).toFixed(4);
    if (!dec.execute) {
      const upd = { ...req, status: dec.status, note: dec.reason, updatedAt: iso };
      if (!ledger.some((r) => r.id === req.id)) d.writeLedger([...ledger, upd]);
      d.log('warn', `[owner-withdraw] ${req.id} ${sol} SOL ${req.wallet} → ${req.to}: ${dec.status} (${dec.reason})`);
      out.push(upd);
      continue;
    }
    const executing = { ...req, status: 'executing' as const, updatedAt: iso };
    d.writeLedger([...ledger, executing]); // persist BEFORE sending → never double send
    d.log('info', `[owner-withdraw] ${req.id} sending ${sol} SOL from ${req.wallet} → ${req.to}`);
    let final: OwnerWithdrawRequest;
    try {
      const sig = await d.send(req.wallet, req.to, req.lamports);
      final = { ...executing, status: 'sent', signature: sig, note: null, updatedAt: new Date(d.now?.() ?? Date.now()).toISOString() };
      d.log('info', `[owner-withdraw] ${req.id} sent ${sig}`);
    } catch (e) {
      final = { ...executing, status: 'failed', note: (e as Error).message.slice(0, 200), updatedAt: new Date(d.now?.() ?? Date.now()).toISOString() };
      d.log('error', `[owner-withdraw] ${req.id} failed: ${final.note}`);
    }
    d.writeLedger(d.readLedger().map((r) => (r.id === req.id ? final : r)));
    out.push(final);
  }
  return out;
}
