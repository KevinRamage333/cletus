import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tryAcquireLiveWorkerLock, lockHolderPid, defaultLiveWorkerLockPath } from '@/lib/worker-lock';

const locks: Array<{ release: () => void }> = [];
afterEach(() => { while (locks.length) locks.pop()?.release(); });

describe('live worker exclusive lock', () => {
  it('defaults to logs/live-worker.lock under the root', () => {
    expect(defaultLiveWorkerLockPath({ LIVE_WORKER_LOCK: '/tmp/x.lock' })).toBe('/tmp/x.lock');
    expect(defaultLiveWorkerLockPath({ LIVE_WORKER_ROOT: '/repo' }, '/cwd')).toBe(path.join('/repo', 'logs', 'live-worker.lock'));
  });

  it('the second acquirer fails while the first holds the flock, then succeeds after release', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cletus-lock-'));
    const lockPath = path.join(dir, 'live-worker.lock');
    const a = tryAcquireLiveWorkerLock({ lockPath, cmd: 'scripts/live-worker.ts test-a' });
    expect(a).not.toBeNull();
    locks.push(a!);
    expect(lockHolderPid(lockPath)).toBe(process.pid);
    const b = tryAcquireLiveWorkerLock({ lockPath, cmd: 'scripts/live-worker.ts test-b' });
    expect(b).toBeNull();
    a!.release();
    const c = tryAcquireLiveWorkerLock({ lockPath, cmd: 'scripts/live-worker.ts test-c' });
    expect(c).not.toBeNull();
    locks.push(c!);
    c!.release();
  });
});

  it('refuses to start when the flock helper is unavailable (no racy pid fallback)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cletus-lock-'));
    const lockPath = path.join(dir, 'live-worker.lock');
    const got = tryAcquireLiveWorkerLock({
      lockPath,
      cwd: dir,
      env: { LIVE_WORKER_FLOCK_HELPER: path.join(dir, 'missing.py') },
      cmd: 'scripts/live-worker.ts test-no-helper',
    });
    expect(got).toBeNull();
  });

