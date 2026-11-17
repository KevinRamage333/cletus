/** Pure heartbeat policy. Monitoring never authorizes trades or restarts live execution. */
export const PAPER_HEARTBEAT_STALE_MS = 3 * 60_000;
export type HeartbeatStatus = 'never_seen' | 'recent' | 'stale' | 'future_timestamp';

export function classifyPaperHeartbeat(nowMs: number, lastHeartbeatMs: number | null, staleMs = PAPER_HEARTBEAT_STALE_MS): {
  status: HeartbeatStatus;
  ageSeconds: number | null;
  alert: boolean;
} {
  if (lastHeartbeatMs === null || !Number.isFinite(lastHeartbeatMs)) return { status: 'never_seen', ageSeconds: null, alert: true };
  const age = nowMs - lastHeartbeatMs;
  if (age < -60_000) return { status: 'future_timestamp', ageSeconds: null, alert: true };
  const ageSeconds = Math.max(0, Math.floor(age / 1000));
  return { status: age > staleMs ? 'stale' : 'recent', ageSeconds, alert: age > staleMs };
}
