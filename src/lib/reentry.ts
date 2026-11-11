/**
 * Re-entry cooldown for the live owner: no re-buy of a coin for REENTRY_COOLDOWN_HOURS (default 24; 0 = off) after
 * a live close of that coin at a loss (stop-out, loss exit, manual sell at a loss, write-off). Read from the
 * Position table, so it survives restarts with no extra state.
 */
export const reentryCooldownHours = (env: Record<string, string | undefined> = process.env) => {
  const v = Number(env.REENTRY_COOLDOWN_HOURS ?? 24);
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 168) : 24;
};

export interface LastClose { closedAt: Date | null; pnlUsd: number | null; exitReason: string | null }
const LOSS_REASONS = new Set(['stop_loss', 'stuck_written_off', 'external_zero', 'dev_exit', 'whale_exit', 'holder_exit']);

/** Pure: the remaining ban (minutes) for this coin, or null if it may be bought. */
export function reentryBan(last: LastClose | null, now: number, hours: number): { minutesLeft: number; why: string } | null {
  if (!last || !last.closedAt || !(hours > 0)) return null;
  const loss = (last.pnlUsd ?? 0) < 0 || LOSS_REASONS.has(last.exitReason ?? '');
  if (!loss) return null;
  const left = last.closedAt.getTime() + hours * 3_600_000 - now;
  return left > 0 ? { minutesLeft: Math.ceil(left / 60_000), why: `${last.exitReason ?? 'loss'} ${last.pnlUsd !== null ? `${last.pnlUsd >= 0 ? '+' : '-'}$${Math.abs(last.pnlUsd).toFixed(2)}` : ''}`.trim() } : null;
}
