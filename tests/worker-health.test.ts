import { describe, it, expect } from 'vitest';
import { shouldRestartForStaleScan, staleScanAgeMs, parseScanAt, DEFAULT_STALE_SCAN_MS } from '@/lib/worker-health';
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
