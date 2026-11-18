/**
 * Exclusive OS lock so a second live-worker process exits before any trading init.
 * Preferred: flock(2) on logs/live-worker.lock, held for our lifetime by a tiny
 * Python helper (stdin pipe stays open in this process). Fallback: a lock file
 * with pid + cmdline liveness if Python/flock is unavailable.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_LOCK_NAME = 'live-worker.lock';

export type WorkerLock = {
  lockPath: string;
  release: () => void;
};

type Holder = { child?: ChildProcess; lockPath: string; statusPath?: string; released: boolean; release: () => void };

const held: Holder[] = [];

export function defaultLiveWorkerLockPath(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): string {
  if (env.LIVE_WORKER_LOCK) return env.LIVE_WORKER_LOCK;
  const root = env.LIVE_WORKER_ROOT || cwd;
  return path.join(root, 'logs', DEFAULT_LOCK_NAME);
}

export function lockHolderPid(lockPath: string): number | null {
  try {
    const first = fs.readFileSync(lockPath, 'utf8').trim().split(/\s+/)[0];
    const n = Number(first);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** True if pid is alive and its cmdline looks like a live-worker entry (not rg/grep). */
export function pidHoldsLiveWorker(pid: number, entryHint = 'live-worker.ts'): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
    if (!cmd.includes(entryHint)) return false;
    if (/\brg\b|\bgrep\b|\bless\b|\bvim?\b/.test(cmd) && !cmd.includes('tsx') && !cmd.includes('node')) return false;
    return true;
  } catch {
    return true;
  }
}

function holderScript(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): string | null {
  const candidates = [
    env.LIVE_WORKER_FLOCK_HELPER,
    path.join(cwd, 'scripts', 'hold-worker-lock.py'),
    path.join(env.LIVE_WORKER_ROOT || cwd, 'scripts', 'hold-worker-lock.py'),
  ].filter((p): p is string => !!p);
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function releaseHolder(h: Holder): void {
  if (h.released) return;
  h.released = true;
  try { h.child?.stdin?.end(); } catch { /* ignore */ }
  try { h.child?.kill('SIGTERM'); } catch { /* ignore */ }
  if (h.statusPath) {
    try { fs.unlinkSync(h.statusPath); } catch { /* ignore */ }
    try { fs.unlinkSync(h.statusPath + '.tmp'); } catch { /* ignore */ }
  }
}

function installReleaseHooks(h: Holder): void {
  held.push(h);
  const once = () => h.release();
  process.once('exit', once);
  process.once('SIGTERM', () => { once(); process.exit(0); });
  process.once('SIGINT', () => { once(); process.exit(0); });
}

function waitForStatus(statusPath: string, timeoutMs: number): string {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (fs.existsSync(statusPath)) {
        const msg = fs.readFileSync(statusPath, 'utf8').trim();
        if (msg) return msg;
      }
    } catch { /* retry */ }
    sleepMs(20);
  }
  return 'TIMEOUT';
}

function acquireFlock(lockPath: string, script: string, pid: number, timeoutMs = 4_000): WorkerLock | null {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const statusPath = `${lockPath}.status.${pid}`;
  try { fs.unlinkSync(statusPath); } catch { /* ok */ }
  const child = spawn('python3', [script, lockPath, String(pid), statusPath], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  const status = waitForStatus(statusPath, timeoutMs);
  if (status !== 'OK') {
    try { child.stdin?.end(); } catch { /* ignore */ }
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    try { fs.unlinkSync(statusPath); } catch { /* ignore */ }
    return null;
  }
  const h: Holder = { child, lockPath, statusPath, released: false, release() { releaseHolder(h); } };
  installReleaseHooks(h);
  return { lockPath, release: () => h.release() };
}

/** Try to take the exclusive live-worker lock. Returns null if another live worker holds it. */
export function tryAcquireLiveWorkerLock(opts: {
  lockPath: string;
  pid?: number;
  cmd?: string;
  entryHint?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}): WorkerLock | null {
  const pid = opts.pid ?? process.pid;
  const cmd = opts.cmd ?? process.argv.join(' ');
  const entryHint = opts.entryHint ?? 'live-worker.ts';
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const script = holderScript(env, cwd);
  if (script) {
    const got = acquireFlock(opts.lockPath, script, pid);
    if (got) {
      try { fs.writeFileSync(opts.lockPath, `${pid} ${cmd}\n`); } catch { /* flock still held */ }
      return got;
    }
    const holder = lockHolderPid(opts.lockPath);
    if (holder && pidHoldsLiveWorker(holder, entryHint)) return null;
    sleepMs(80);
    const retry = acquireFlock(opts.lockPath, script, pid);
    if (retry) {
      try { fs.writeFileSync(retry.lockPath, `${pid} ${cmd}\n`); } catch { /* ignore */ }
      return retry;
    }
    return null;
  }
  // The pid-file fallback (open wx + unlink stale) raced: two processes could
  // unlink each other's newly created lock and both start. The flock helper is required.
  return null;
}

/** Take the lock or exit(0) before any trading init. */
export function acquireLiveWorkerLockOrExit(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): WorkerLock {
  const lockPath = defaultLiveWorkerLockPath(env, cwd);
  const entry = env.LIVE_WORKER_ENTRY || 'live-worker.ts';
  const got = tryAcquireLiveWorkerLock({ lockPath, env, cwd, entryHint: path.basename(entry) });
  if (!got) {
    const holder = lockHolderPid(lockPath);
    console.log(`[cletus] live worker already running${holder ? ` (lock pid ${holder})` : ''} — exiting`);
    process.exit(0);
  }
  return got;
}
