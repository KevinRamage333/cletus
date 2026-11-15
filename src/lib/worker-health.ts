/**
 * Supervisor health: restart a live worker that is still alive but has stopped scanning.
 * Box suspends freeze both the worker and cron; after wake the scan file looks stale.
 * A restart is only for a genuinely hung process — not the first minutes after a resume,
 * and not a single stale observation (clock jump / one check).
 */
import { suspendGapMs } from './watchdog';


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


export const DEFAULT_SUSPEND_GRACE_MS = 3 * 60_000;
export const DEFAULT_REQUIRED_STALE_CHECKS = 2;

export interface SupervisorTickInput {
  nowWallMs: number;
  nowMonoMs: number;
  prevWallMs?: number | null;
  prevMonoMs?: number | null;
  suspendGraceUntilWallMs?: number;
  staleStreak: number;
  maxAgeMs?: number;
  suspendGraceMs?: number;
  requiredStaleChecks?: number;
  suspendToleranceMs?: number;
  scanAtMs: number | null;
  fileMtimeMs?: number | null;
  workerStartedMs?: number | null;
}

export interface SupervisorTickResult {
  shouldRestart: boolean;
  staleNow: boolean;
  staleStreak: number;
  suspendGapMs: number;
  suspendGraceUntilWallMs: number;
  prevWallMs: number;
  prevMonoMs: number;
}

/**
 * One supervisor loop tick: raw scan-age staleness, plus post-resume grace and
 * a required streak of consecutive stale checks before a restart.
 */
export function supervisorTick(s: SupervisorTickInput): SupervisorTickResult {
  const maxAgeMs = s.maxAgeMs ?? DEFAULT_STALE_SCAN_MS;
  const graceMs = s.suspendGraceMs ?? DEFAULT_SUSPEND_GRACE_MS;
  const needed = s.requiredStaleChecks ?? DEFAULT_REQUIRED_STALE_CHECKS;
  const tolerance = s.suspendToleranceMs ?? 5_000;
  let graceUntil = s.suspendGraceUntilWallMs ?? 0;
  let gap = 0;
  if (s.prevWallMs != null && s.prevMonoMs != null) {
    gap = suspendGapMs({ wall: s.prevWallMs, mono: s.prevMonoMs }, { wall: s.nowWallMs, mono: s.nowMonoMs }, tolerance);
    if (gap > 0) graceUntil = s.nowWallMs + graceMs;
  }
  const staleNow = shouldRestartForStaleScan({
    nowMs: s.nowWallMs,
    maxAgeMs,
    scanAtMs: s.scanAtMs,
    fileMtimeMs: s.fileMtimeMs,
    workerStartedMs: s.workerStartedMs,
  });
  const inGrace = graceUntil > s.nowWallMs;
  let staleStreak = s.staleStreak;
  if (inGrace || !staleNow) staleStreak = 0;
  else staleStreak = staleStreak + 1;
  const shouldRestart = !inGrace && staleNow && staleStreak >= needed;
  return {
    shouldRestart,
    staleNow,
    staleStreak,
    suspendGapMs: gap,
    suspendGraceUntilWallMs: graceUntil,
    prevWallMs: s.nowWallMs,
    prevMonoMs: s.nowMonoMs,
  };
}
