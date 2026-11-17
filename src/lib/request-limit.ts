/**
 * Small fixed-window limiter for public write/fan-out routes (Cletus Verified, Token Boost checks).
 * Per instance (memory). It bounds abuse of a single instance; it is not a global quota.
 */
type Win = { start: number; count: number };
const g = globalThis as unknown as { __reqLimit?: Map<string, Win> };
const store = () => (g.__reqLimit ??= new Map());

/** true if allowed (and counted), false if the key is over `limit` in the current `windowMs`. */
export function takeToken(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (!(limit > 0)) return false;
  const m = store();
  const w = m.get(key);
  if (!w || now - w.start >= windowMs) { m.set(key, { start: now, count: 1 }); prune(m, now, windowMs); return true; }
  if (w.count >= limit) return false;
  w.count++;
  return true;
}

function prune(m: Map<string, Win>, now: number, windowMs: number) {
  if (m.size < 5000) return;
  for (const [k, w] of m) if (now - w.start >= windowMs) m.delete(k);
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for / x-real-ip). */
export function clientIp(req: { headers: Headers }): string {
  const xf = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return xf || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Checks every [key, limit] pair; all must pass. Returns false (and counts nothing further) on the first refusal. */
export function allowAll(pairs: Array<[string, number]>, windowMs: number, now = Date.now()): boolean {
  for (const [k, n] of pairs) if (!takeToken(k, n, windowMs, now)) return false;
  return true;
}

export const _resetRequestLimits = () => store().clear();
