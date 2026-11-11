/**
 * Hang protection for the engine loops. A scan or monitor tick that waits on a network call with no
 * timeout used to hold its "running" flag forever (the bot looked alive but stopped scanning and,
 * worse, could stop watching an open position's stop). Ticks now run under a deadline: on expiry the
 * flag is released, the stall is logged with the stage it was stuck in, and the stale tick is fenced
 * off by a generation number so it can never buy or sell after it has been abandoned.
 */
export class DeadlineError extends Error {
  constructor(public label: string, public ms: number) { super(`${label} exceeded ${Math.round(ms / 1000)}s deadline`); this.name = 'DeadlineError'; }
}

/** Resolve/reject with `p`, or reject with DeadlineError after `ms` (the timer never keeps the process alive). */
export function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  if (!(ms > 0)) return p;
  let t: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new DeadlineError(label, ms)), ms); t.unref?.(); });
  return Promise.race([p, timer]).finally(() => { if (t) clearTimeout(t); });
}

/** fetch wrapper that aborts after `ms` unless the caller already passed a signal. */
export function timedFetch(ms: number, base: typeof fetch = fetch): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    base(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) })) as typeof fetch;
}

/** Tracks which tick generation is current; an abandoned tick sees `isCurrent(gen) === false`. */
export interface TickFence { gen: number }
export function nextGen(f: TickFence): number { return ++f.gen; }
export function assertCurrent(f: TickFence, gen: number, label: string): void {
  if (f.gen !== gen) throw new Error(`${label}: abandoned after deadline, not acting`);
}

/** Per-key in-flight guard so two code paths can't sell the same position at once. */
export class InFlight {
  private keys = new Set<string>();
  tryAcquire(k: string): boolean { if (this.keys.has(k)) return false; this.keys.add(k); return true; }
  release(k: string): void { this.keys.delete(k); }
  has(k: string): boolean { return this.keys.has(k); }
}

/** Seconds since `at` (ms) or null. */
export const ageSec = (at: number | null | undefined, now = Date.now()) => (at ? Math.round((now - at) / 1000) : null);

/** Share one in-flight/recent result of `fn` for `ms` (failures are not cached). Cuts duplicate RPC reads per scan. */
export function memoizeFor<T>(ms: number, fn: () => Promise<T>, now: () => number = Date.now): () => Promise<T> {
  let at = -Infinity; let p: Promise<T> | null = null;
  return () => {
    if (p && now() - at < ms) return p;
    at = now();
    p = fn().catch((e) => { p = null; throw e; });
    return p;
  };
}

/**
 * How long the process was frozen (box/VM suspended) between two samples: wall-clock time advanced but the
 * monotonic clock did not. Returns ms of the gap beyond `toleranceMs`, else 0.
 */
export function suspendGapMs(prev: { wall: number; mono: number }, now: { wall: number; mono: number }, toleranceMs = 5_000): number {
  const gap = (now.wall - prev.wall) - (now.mono - prev.mono);
  return gap > toleranceMs ? gap : 0;
}
