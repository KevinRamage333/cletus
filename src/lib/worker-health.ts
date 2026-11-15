/**
 * Supervisor health: restart a live worker that is still alive but has stopped scanning.
 * Box suspends freeze both the worker and cron; after wake the scan file looks stale, and a
 * restart is the intended recovery if the process is hung on Prisma or a websocket reconnect.
 */

export const DEFAULT_STALE_SCAN_MS = 8 * 60_000;

export function staleScanAgeMs(opts: {
  nowMs: number;
  scanAtMs: number | null;
  fileMtimeMs?: number | null;
  workerStartedMs?: number | null;
}): number | null {
  const at = opts.scanAtMs ?? opts.fileMtimeMs ?? opts.workerStartedMs ?? null;
  if (at == null) return null;
  return opts.nowMs - at;
}

/** True when the supervisor should kill a still-running worker because no scan finished within maxAgeMs. */
export function shouldRestartForStaleScan(opts: {
  nowMs: number;
  maxAgeMs?: number;
  scanAtMs: number | null;
  fileMtimeMs?: number | null;
  workerStartedMs?: number | null;
}): boolean {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_STALE_SCAN_MS;
  if (!(maxAgeMs > 0)) return false;
  if (opts.workerStartedMs != null && opts.nowMs - opts.workerStartedMs < maxAgeMs) return false;
  const age = staleScanAgeMs(opts);
  if (age == null) return false;
  return age >= maxAgeMs;
}

export function parseScanAt(json: string | null | undefined): number | null {
  if (!json) return null;
  try {
    const at = (JSON.parse(json) as { at?: unknown }).at;
    if (typeof at !== 'string') return null;
    const ms = Date.parse(at);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}
