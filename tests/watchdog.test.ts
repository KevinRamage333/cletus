import { describe, it, expect, vi } from 'vitest';
import { withDeadline, DeadlineError, timedFetch, nextGen, assertCurrent, InFlight } from '../src/lib/watchdog';

describe('watchdog', () => {
  it('passes through a fast result', async () => {
    await expect(withDeadline(Promise.resolve(7), 1000, 'x')).resolves.toBe(7);
  });
  it('rejects a hung promise with DeadlineError', async () => {
    vi.useFakeTimers();
    const p = withDeadline(new Promise(() => undefined), 5000, 'scan tick');
    const chk = expect(p).rejects.toBeInstanceOf(DeadlineError);
    await vi.advanceTimersByTimeAsync(5001);
    await chk;
    vi.useRealTimers();
  });
  it('propagates the inner error', async () => {
    await expect(withDeadline(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });
  it('timedFetch adds an abort signal, keeps a caller signal', async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const base = (async (_u: unknown, init?: RequestInit) => { seen.push(init?.signal); return new Response('{}'); }) as unknown as typeof fetch;
    const f = timedFetch(1000, base);
    await f('http://x', { method: 'POST' });
    const mine = new AbortController().signal;
    await f('http://x', { signal: mine });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[1]).toBe(mine);
  });
  it('timedFetch aborts a request that never answers', async () => {
    const base = ((_u: unknown, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    await expect(timedFetch(20, base)('http://x')).rejects.toThrow('aborted');
  });
  it('an abandoned tick generation cannot act', () => {
    const f = { gen: 0 };
    const g1 = nextGen(f);
    expect(() => assertCurrent(f, g1, 'scan')).not.toThrow();
    nextGen(f); // watchdog fenced it off
    expect(() => assertCurrent(f, g1, 'scan')).toThrow(/abandoned/);
  });
  it('InFlight blocks a second concurrent sell of the same position', () => {
    const l = new InFlight();
    expect(l.tryAcquire('p1')).toBe(true);
    expect(l.tryAcquire('p1')).toBe(false);
    expect(l.tryAcquire('p2')).toBe(true);
    l.release('p1');
    expect(l.tryAcquire('p1')).toBe(true);
  });
});
