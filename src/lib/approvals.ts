/**
 * Non-custodial trade-approval queue. Cletus prepares a Jupiter V2 /order (unsigned);
 * the user approves each swap in their own wallet. No delegated or session keys,
 * and no custody of user funds.
 */
import { DEFAULT_OPERATOR_FEE_BPS } from './jupiter';

export const APPROVAL_TTL_MS = 60_000;
export const SOLSCAN_ACCOUNT = 'https://solscan.io/account/';
export const SOLSCAN_TX = 'https://solscan.io/tx/';

export type ApprovalStatus = 'pending' | 'rejected' | 'expired' | 'executed' | 'failed';
export type ApprovalSide = 'buy' | 'sell';

export interface ApprovalRecord {
  id: string;
  status: ApprovalStatus;
  side: ApprovalSide;
  mint: string;
  symbol: string;
  sizeUsd: number;
  expiresAt: string | Date;
  operatorFeeBps?: number;
  operatorFeeUsd?: number;
  feeUsd?: number;
  signature?: string | null;
  requestId?: string | null;
  transaction?: string | null;
  reason?: string | null;
  score?: number | null;
  priceImpactPct?: number | null;
}

export function operatorFeeUsd(notionalUsd: number, bps: number = DEFAULT_OPERATOR_FEE_BPS): number {
  if (!(notionalUsd > 0) || !(bps > 0)) return 0;
  return Math.round((notionalUsd * bps) / 10_000 * 1e6) / 1e6;
}

/** Platform-fee view for a trade (entry always; exit when a sell notional is known). */
export function tradeFeeView(p: {
  sizeUsd: number;
  feesUsd?: number | null;
  tokenAmount?: number | null;
  exitPrice?: number | null;
}, bps: number = DEFAULT_OPERATOR_FEE_BPS) {
  const entryOperatorFeeUsd = operatorFeeUsd(p.sizeUsd, bps);
  const exitNotional = p.exitPrice && p.tokenAmount ? p.exitPrice * p.tokenAmount : 0;
  const exitOperatorFeeUsd = operatorFeeUsd(exitNotional, bps);
  return {
    feesUsd: p.feesUsd ?? 0,
    operatorFeeBps: bps,
    operatorFeeUsd: Math.round((entryOperatorFeeUsd + exitOperatorFeeUsd) * 1e6) / 1e6,
    entryOperatorFeeUsd,
    exitOperatorFeeUsd,
  };
}

export function expiresAtFrom(now = Date.now(), ttlMs = APPROVAL_TTL_MS): Date {
  return new Date(now + ttlMs);
}

export function remainingMs(expiresAt: string | Date, now = Date.now()): number {
  const t = typeof expiresAt === 'string' ? Date.parse(expiresAt) : expiresAt.getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, t - now);
}

export function effectiveStatus(row: Pick<ApprovalRecord, 'status' | 'expiresAt'>, now = Date.now()): ApprovalStatus {
  if (row.status === 'pending' && remainingMs(row.expiresAt, now) <= 0) return 'expired';
  return row.status;
}

export function canApprove(row: ApprovalRecord, now = Date.now()): { ok: true } | { ok: false; error: string } {
  const st = effectiveStatus(row, now);
  if (st === 'expired') return { ok: false, error: 'this suggestion has expired; Cletus will prepare a fresh one' };
  if (st !== 'pending') return { ok: false, error: `this suggestion is already ${st}` };
  if (!row.transaction) return { ok: false, error: 'no unsigned swap is ready to approve yet' };
  return { ok: true };
}

export function canReject(row: Pick<ApprovalRecord, 'status' | 'expiresAt'>, now = Date.now()): { ok: true } | { ok: false; error: string } {
  const st = effectiveStatus(row, now);
  if (st === 'pending') return { ok: true };
  return { ok: false, error: `this suggestion is already ${st}` };
}

export function solscanTxUrl(signature?: string | null): string | null {
  if (!signature || !/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(signature)) return null;
  return `${SOLSCAN_TX}${signature}`;
}

export function solscanAccountUrl(address?: string | null): string | null {
  if (!address) return null;
  return `${SOLSCAN_ACCOUNT}${address}`;
}

export function formatTimer(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${r.toString().padStart(2, '0')}` : `${s}s`;
}
