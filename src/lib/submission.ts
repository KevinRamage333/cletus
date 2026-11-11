/**
 * Transaction submission path for LIVE swaps (config-driven; pure planning is unit-tested).
 *   standard     -> send via the main RPC (Helius etc.)
 *   private_rpc  -> send via PRIVATE_RPC_URL (e.g. a staked/private relay) for MEV protection
 *   jito         -> send to a Jito block engine with a tip (Jupiter adds the tip instruction)
 */
export type SubmissionMode = 'standard' | 'private_rpc' | 'jito';
export interface SubmissionConfig { submissionMode: SubmissionMode; privateRpcUrl: string | null; jitoBlockEngineUrl: string; jitoTipLamports: number; rpcUrl: string }
export interface SubmissionPlan { mode: SubmissionMode; sendUrl: string; prioritization: number | { jitoTipLamports: number }; skipPreflight: boolean; note?: string }

export function submissionPlan(c: SubmissionConfig, priorityFeeLamports: number): SubmissionPlan {
  if (c.submissionMode === 'jito') {
    return { mode: 'jito', sendUrl: `${c.jitoBlockEngineUrl.replace(/\/$/, '')}/api/v1/transactions`, prioritization: { jitoTipLamports: Math.max(1000, c.jitoTipLamports) }, skipPreflight: true };
  }
  if (c.submissionMode === 'private_rpc') {
    if (!c.privateRpcUrl) return { mode: 'standard', sendUrl: c.rpcUrl, prioritization: priorityFeeLamports, skipPreflight: false, note: 'SWAP_SUBMISSION_MODE=private_rpc but PRIVATE_RPC_URL unset; falling back to standard' };
    return { mode: 'private_rpc', sendUrl: c.privateRpcUrl, prioritization: priorityFeeLamports, skipPreflight: false };
  }
  return { mode: 'standard', sendUrl: c.rpcUrl, prioritization: priorityFeeLamports, skipPreflight: false };
}

export function parseSubmissionMode(v: string | undefined): SubmissionMode {
  const s = (v ?? '').trim().toLowerCase();
  return s === 'jito' || s === 'private_rpc' ? s : 'standard';
}
