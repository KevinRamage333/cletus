/**
 * Self-healing execution state. On each failure: raise the priority fee,
 * widen slippage (both capped). After N consecutive failures: pause.
 * On success: reset the failure counter and decay back toward the base values.
 */
export interface HealState { priorityFeeLamports: number; slippageBps: number; consecutiveFailures: number; pausedUntil: Date | null }
export interface HealParams { basePriorityFee: number; baseSlippageBps: number; escalation: number; maxPriorityFee: number; widenStepBps: number; maxSlippageBps: number; maxConsecutiveFailures: number; pauseMinutes: number }

export type FailureKind = 'tx_dropped' | 'slippage' | 'rpc' | 'api' | 'other';

export function onFailure(s: HealState, kind: FailureKind, p: HealParams, now = new Date()): HealState {
  const next = { ...s, consecutiveFailures: s.consecutiveFailures + 1 };
  if (kind === 'tx_dropped' || kind === 'rpc' || kind === 'other') next.priorityFeeLamports = Math.min(p.maxPriorityFee, Math.round(s.priorityFeeLamports * p.escalation));
  if (kind === 'slippage' || kind === 'other') next.slippageBps = Math.min(p.maxSlippageBps, s.slippageBps + p.widenStepBps);
  if (next.consecutiveFailures >= p.maxConsecutiveFailures) next.pausedUntil = new Date(now.getTime() + p.pauseMinutes * 60_000);
  return next;
}

export function onSuccess(s: HealState, p: HealParams): HealState {
  return {
    consecutiveFailures: 0,
    pausedUntil: null,
    priorityFeeLamports: Math.max(p.basePriorityFee, Math.round((s.priorityFeeLamports + p.basePriorityFee) / 2)),
    slippageBps: Math.max(p.baseSlippageBps, Math.round((s.slippageBps + p.baseSlippageBps) / 2)),
  };
}

export function isPaused(s: HealState, now = new Date()): boolean {
  return Boolean(s.pausedUntil && s.pausedUntil.getTime() > now.getTime());
}

export function classifyError(e: unknown): FailureKind {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  if (m.includes('slippage') || m.includes('0x1771') || m.includes('exceeds desired')) return 'slippage';
  if (m.includes('blockhash') || m.includes('expired') || m.includes('not confirmed') || m.includes('timeout')) return 'tx_dropped';
  if (m.includes('429') || m.includes('fetch') || m.includes('econn') || m.includes('rpc')) return 'rpc';
  return 'other';
}
