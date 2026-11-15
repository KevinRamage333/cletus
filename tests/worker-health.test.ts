import { describe, it, expect } from 'vitest';
import { shouldRestartForStaleScan, staleScanAgeMs, parseScanAt, DEFAULT_STALE_SCAN_MS, DEFAULT_SUSPEND_GRACE_MS, supervisorTick } from '@/lib/worker-health';
import { wsAttemptTimedOut, wsHandshakeTimeoutMs, wsCloseGraceMs } from '@/lib/helius';

describe('stale-scan supervisor restart', () => {
  const max = DEFAULT_STALE_SCAN_MS;
  const started = 1_000_000;

  it('defaults to 8 minutes', () => {
    expect(DEFAULT_STALE_SCAN_MS).toBe(8 * 60_000);
  });

  it('does not restart during the start grace window, even if the scan file is old or missing', () => {
    expect(shouldRestartForStaleScan({ nowMs: started + 60_000, maxAgeMs: max, scanAtMs: started - 60 * 60_000, workerStartedMs: started })).toBe(false);
    expect(shouldRestartForStaleScan({ nowMs: started + 60_000, maxAgeMs: max, scanAtMs: null, workerStartedMs: started })).toBe(false);
  });

  it('restarts when the last scan is older than the limit and the grace has passed', () => {
    const now = started + max + 1_000;
    expect(shouldRestartForStaleScan({ nowMs: now, maxAgeMs: max, scanAtMs: started, workerStartedMs: started })).toBe(true);
    expect(shouldRestartForStaleScan({ nowMs: now, maxAgeMs: max, scanAtMs: now - 60_000, workerStartedMs: started })).toBe(false);
  });

  it('falls back to file mtime, then worker start, and does not restart with no timestamps', () => {
    const now = started + max + 1_000;
    expect(shouldRestartForStaleScan({ nowMs: now, maxAgeMs: max, scanAtMs: null, fileMtimeMs: started, workerStartedMs: started })).toBe(true);
    expect(shouldRestartForStaleScan({ nowMs: now, maxAgeMs: max, scanAtMs: null, workerStartedMs: started })).toBe(true);
    expect(shouldRestartForStaleScan({ nowMs: now, maxAgeMs: max, scanAtMs: null })).toBe(false);
  });

  it('parses scan-latest at and reports age', () => {
    expect(parseScanAt('{"at":"2026-11-15T06:35:00.000Z"}')).toBe(Date.parse('2026-11-15T06:35:00.000Z'));
    expect(parseScanAt('not-json')).toBeNull();
    expect(staleScanAgeMs({ nowMs: 10_000, scanAtMs: 2_000 })).toBe(8_000);
  });
});

describe('websocket reconnect timeouts', () => {
  it('defaults and flags a hung handshake or close', () => {
    expect(wsHandshakeTimeoutMs({})).toBe(8_000);
    expect(wsCloseGraceMs({})).toBe(2_000);
    expect(wsHandshakeTimeoutMs({ HELIUS_WS_CONNECT_TIMEOUT_MS: '5000' })).toBe(5_000);
    expect(wsAttemptTimedOut(0, 7_999, 8_000)).toBe(false);
    expect(wsAttemptTimedOut(0, 8_000, 8_000)).toBe(true);
  });
});

describe('supervisorTick post-resume grace and streak', () => {
  const max = DEFAULT_STALE_SCAN_MS;
  const started = 1_000_000;
  const now = started + max + 60_000; // scan is stale by age
  const base = { maxAgeMs: max, scanAtMs: started, workerStartedMs: started, staleStreak: 0 };

  it('does not restart on the first stale check, only after the required streak', () => {
    const a = supervisorTick({ ...base, nowWallMs: now, nowMonoMs: now });
    expect(a.staleNow).toBe(true);
    expect(a.shouldRestart).toBe(false);
    expect(a.staleStreak).toBe(1);
    const b = supervisorTick({ ...base, nowWallMs: now + 15_000, nowMonoMs: now + 15_000, prevWallMs: a.prevWallMs, prevMonoMs: a.prevMonoMs, staleStreak: a.staleStreak, suspendGraceUntilWallMs: a.suspendGraceUntilWallMs });
    expect(b.shouldRestart).toBe(true);
    expect(b.staleStreak).toBe(2);
  });

  it('ignores a stale scan file for a few minutes after a detected suspend/resume', () => {
    const wakeWall = now + 600_000;
    const wakeMono = now + 10_000; // wall jumped ~10min more than mono
    const a = supervisorTick({ ...base, nowWallMs: wakeWall, nowMonoMs: wakeMono, prevWallMs: now, prevMonoMs: now, staleStreak: 2 });
    expect(a.suspendGapMs).toBeGreaterThan(0);
    expect(a.shouldRestart).toBe(false);
    expect(a.staleStreak).toBe(0);
    expect(a.suspendGraceUntilWallMs).toBe(wakeWall + DEFAULT_SUSPEND_GRACE_MS);
    // still inside grace, even if we keep seeing a stale scan
    const mid = supervisorTick({ ...base, nowWallMs: wakeWall + 60_000, nowMonoMs: wakeMono + 60_000, prevWallMs: a.prevWallMs, prevMonoMs: a.prevMonoMs, staleStreak: a.staleStreak, suspendGraceUntilWallMs: a.suspendGraceUntilWallMs });
    expect(mid.shouldRestart).toBe(false);
    expect(mid.staleStreak).toBe(0);
    // after grace, still needs two consecutive stale checks
    const after = wakeWall + DEFAULT_SUSPEND_GRACE_MS + 1;
    const monoAfter = wakeMono + DEFAULT_SUSPEND_GRACE_MS + 1;
    const c = supervisorTick({ ...base, nowWallMs: after, nowMonoMs: monoAfter, prevWallMs: mid.prevWallMs, prevMonoMs: mid.prevMonoMs, staleStreak: mid.staleStreak, suspendGraceUntilWallMs: mid.suspendGraceUntilWallMs });
    expect(c.staleNow).toBe(true);
    expect(c.shouldRestart).toBe(false);
    const d = supervisorTick({ ...base, nowWallMs: after + 15_000, nowMonoMs: monoAfter + 15_000, prevWallMs: c.prevWallMs, prevMonoMs: c.prevMonoMs, staleStreak: c.staleStreak, suspendGraceUntilWallMs: c.suspendGraceUntilWallMs });
    expect(d.shouldRestart).toBe(true);
  });

  it('resets the streak when a fresh scan arrives', () => {
    const a = supervisorTick({ ...base, nowWallMs: now, nowMonoMs: now });
    expect(a.staleStreak).toBe(1);
    const b = supervisorTick({ ...base, nowWallMs: now + 15_000, nowMonoMs: now + 15_000, prevWallMs: a.prevWallMs, prevMonoMs: a.prevMonoMs, staleStreak: a.staleStreak, scanAtMs: now + 10_000 });
    expect(b.staleNow).toBe(false);
    expect(b.staleStreak).toBe(0);
    expect(b.shouldRestart).toBe(false);
  });
});
