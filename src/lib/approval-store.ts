/**
 * Database helpers for the non-custodial approval queue. Never signs, never loads a key.
 */
import { prisma } from './db';
import { canApprove, canReject, effectiveStatus, expiresAtFrom, operatorFeeUsd, type ApprovalRecord, type ApprovalSide, type ApprovalStatus } from './approvals';
import { DEFAULT_OPERATOR_FEE_BPS } from './jupiter';
import { prepareUserSwap, submitUserSwap } from './user-swaps';

function view(row: {
  id: string; status: string; side: string; mint: string; symbol: string; sizeUsd: number;
  expiresAt: Date; operatorFeeBps: number; operatorFeeUsd: number; feeUsd: number;
  signature: string | null; requestId: string | null; transaction: string | null;
  reason: string | null; score: number | null; priceImpactPct: number | null; error?: string | null;
  createdAt?: Date; resolvedAt?: Date | null; inAmount?: string | null; outAmount?: string | null;
}): ApprovalRecord & { error?: string | null; createdAt?: string; resolvedAt?: string | null; inAmount?: string | null; outAmount?: string | null; transactionReady: boolean } {
  const status = effectiveStatus({ status: row.status as ApprovalStatus, expiresAt: row.expiresAt });
  return {
    id: row.id, status, side: row.side as ApprovalSide, mint: row.mint, symbol: row.symbol, sizeUsd: row.sizeUsd,
    expiresAt: row.expiresAt.toISOString(), operatorFeeBps: row.operatorFeeBps, operatorFeeUsd: row.operatorFeeUsd,
    feeUsd: row.feeUsd, signature: row.signature, requestId: row.requestId,
    // Never send the huge unsigned tx in list views unless still pending and unexpired.
    transaction: status === 'pending' ? row.transaction : null,
    transactionReady: status === 'pending' && !!row.transaction,
    reason: row.reason, score: row.score, priceImpactPct: row.priceImpactPct,
    error: row.error, createdAt: row.createdAt?.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null,
    inAmount: row.inAmount, outAmount: row.outAmount,
  };
}

export async function listApprovals(accountId: string, take = 30) {
  const rows = await prisma.tradeApproval.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take });
  const now = new Date();
  const expiredIds = rows.filter((r) => r.status === 'pending' && r.expiresAt <= now).map((r) => r.id);
  if (expiredIds.length) await prisma.tradeApproval.updateMany({ where: { id: { in: expiredIds } }, data: { status: 'expired', resolvedAt: now } });
  return rows.map((r) => view({ ...r, status: expiredIds.includes(r.id) ? 'expired' : r.status }));
}

export async function createApproval(input: {
  accountId: string; mint: string; symbol: string; side: ApprovalSide; sizeUsd: number;
  inputMint: string; outputMint: string; amountRaw: string; reason?: string; score?: number;
  taker: string; slippageBps?: number;
}) {
  const prepared = await prepareUserSwap({
    taker: input.taker, inputMint: input.inputMint, outputMint: input.outputMint,
    amount: input.amountRaw, slippageBps: input.slippageBps,
  });
  const bps = DEFAULT_OPERATOR_FEE_BPS;
  const row = await prisma.tradeApproval.create({
    data: {
      accountId: input.accountId, mint: input.mint, symbol: input.symbol, side: input.side, sizeUsd: input.sizeUsd,
      inputMint: input.inputMint, outputMint: input.outputMint, amountRaw: String(input.amountRaw),
      inAmount: prepared.inAmount, outAmount: prepared.outAmount, requestId: prepared.requestId,
      transaction: prepared.transaction, status: 'pending', expiresAt: expiresAtFrom(),
      operatorFeeBps: bps, operatorFeeUsd: operatorFeeUsd(input.sizeUsd, bps),
      feeUsd: operatorFeeUsd(input.sizeUsd, prepared.feeBps),
      priceImpactPct: prepared.priceImpactPct, reason: input.reason ?? null, score: input.score ?? null,
    },
  });
  return view(row);
}

export async function loadApproval(accountId: string, id: string) {
  const row = await prisma.tradeApproval.findFirst({ where: { id, accountId } });
  return row;
}

export async function rejectApproval(accountId: string, id: string) {
  const row = await loadApproval(accountId, id);
  if (!row) return { ok: false as const, error: 'suggestion not found', status: 404 };
  const check = canReject({ status: row.status as ApprovalStatus, expiresAt: row.expiresAt });
  if (!check.ok) return { ok: false as const, error: check.error, status: 400 };
  const updated = await prisma.tradeApproval.update({ where: { id }, data: { status: 'rejected', resolvedAt: new Date(), transaction: null } });
  return { ok: true as const, approval: view(updated) };
}

export async function refreshOrder(accountId: string, id: string, taker: string, slippageBps?: number) {
  const row = await loadApproval(accountId, id);
  if (!row) return { ok: false as const, error: 'suggestion not found', status: 404 };
  const check = canReject({ status: row.status as ApprovalStatus, expiresAt: row.expiresAt }); // pending (or we re-check expiry)
  if (row.status !== 'pending') return { ok: false as const, error: `this suggestion is already ${row.status}`, status: 400 };
  if (row.expiresAt <= new Date()) {
    await prisma.tradeApproval.update({ where: { id }, data: { status: 'expired', resolvedAt: new Date() } });
    return { ok: false as const, error: 'this suggestion has expired; Cletus will prepare a fresh one', status: 400 };
  }
  const prepared = await prepareUserSwap({
    taker, inputMint: row.inputMint, outputMint: row.outputMint, amount: row.amountRaw, slippageBps,
  });
  const updated = await prisma.tradeApproval.update({
    where: { id },
    data: {
      requestId: prepared.requestId, transaction: prepared.transaction,
      inAmount: prepared.inAmount, outAmount: prepared.outAmount,
      feeUsd: operatorFeeUsd(row.sizeUsd, prepared.feeBps),
      priceImpactPct: prepared.priceImpactPct,
      expiresAt: expiresAtFrom(),
    },
  });
  return { ok: true as const, approval: view(updated) };
}

export async function executeApproval(accountId: string, id: string, signedTransaction: string) {
  const row = await loadApproval(accountId, id);
  if (!row) return { ok: false as const, error: 'suggestion not found', status: 404 };
  const check = canApprove({ ...row, status: row.status as ApprovalStatus, side: row.side as ApprovalSide });
  if (!check.ok) return { ok: false as const, error: check.error, status: 400 };
  if (!row.requestId) return { ok: false as const, error: 'missing Jupiter request id; refresh the order', status: 400 };
  if (typeof signedTransaction !== 'string' || signedTransaction.length < 32 || signedTransaction.length > 20_000) {
    return { ok: false as const, error: 'signed transaction missing or invalid', status: 400 };
  }
  try {
    const ex = await submitUserSwap(signedTransaction, row.requestId);
    const updated = await prisma.tradeApproval.update({
      where: { id },
      data: { status: 'executed', signature: ex.signature, resolvedAt: new Date(), transaction: null },
    });
    return { ok: true as const, approval: view(updated), signature: ex.signature };
  } catch (e) {
    const message = (e as Error).message ?? 'execute failed';
    await prisma.tradeApproval.update({ where: { id }, data: { status: 'failed', error: message.slice(0, 500), resolvedAt: new Date(), transaction: null } });
    return { ok: false as const, error: message, status: 400 };
  }
}
