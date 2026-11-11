/**
 * Free-tier-friendly limiter for Gemini (pure core; unit-tested).
 * - Minimum spacing between requests (GEMINI_MIN_INTERVAL_MS, default 6500 ms, about 9 RPM).
 * - Daily request cap (GEMINI_DAILY_REQUEST_CAP, default 200; free gemini-2.5-flash allows roughly 250/day).
 * - On HTTP 429, honour RetryInfo/Retry-After and back off exponentially; while cooling down,
 *   calls fail fast so the Brain falls through to the next provider instead of burning quota.
 */
export interface LimiterState { lastAt: number; day: string; count: number; cooldownUntil: number; strikes: number }
export interface LimiterParams { minIntervalMs: number; dailyCap: number; baseBackoffMs: number; maxBackoffMs: number }

export const newLimiterState = (): LimiterState => ({ lastAt: 0, day: '', count: 0, cooldownUntil: 0, strikes: 0 });
const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Returns ms to wait before a call is allowed, or a refusal reason. Does not mutate. */
export function checkLimit(s: LimiterState, now: number, p: LimiterParams): { ok: true; waitMs: number } | { ok: false; reason: string } {
  if (now < s.cooldownUntil) return { ok: false, reason: `Gemini rate-limited (429), cooling down ${Math.ceil((s.cooldownUntil - now) / 1000)}s` };
  const count = s.day === dayOf(now) ? s.count : 0;
  if (p.dailyCap > 0 && count >= p.dailyCap) return { ok: false, reason: `Gemini daily cap reached (${p.dailyCap})` };
  return { ok: true, waitMs: Math.max(0, s.lastAt + p.minIntervalMs - now) };
}

export function recordCall(s: LimiterState, now: number): LimiterState {
  const d = dayOf(now);
  return { ...s, lastAt: now, day: d, count: (s.day === d ? s.count : 0) + 1 };
}

export function record429(s: LimiterState, now: number, p: LimiterParams, retryAfterMs: number | null): LimiterState {
  const strikes = s.strikes + 1;
  const backoff = Math.min(p.maxBackoffMs, p.baseBackoffMs * 2 ** (strikes - 1));
  return { ...s, strikes, cooldownUntil: now + Math.max(retryAfterMs ?? 0, backoff) };
}

export const recordSuccess = (s: LimiterState): LimiterState => ({ ...s, strikes: 0 });

/** Parse Retry-After header or Google RetryInfo `retryDelay: "32s"` from a 429 body. */
export function parseRetryDelayMs(header: string | null, body: string): number | null {
  if (header) { const n = Number(header); if (Number.isFinite(n)) return n * 1000; }
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

export function limiterParams(env: Record<string, string | undefined> = process.env): LimiterParams {
  const n = (k: string, d: number) => { const v = Number(env[k]); return Number.isFinite(v) && env[k] !== '' && env[k] !== undefined ? v : d; };
  return { minIntervalMs: n('GEMINI_MIN_INTERVAL_MS', 6500), dailyCap: n('GEMINI_DAILY_REQUEST_CAP', 200), baseBackoffMs: n('GEMINI_BACKOFF_BASE_MS', 30_000), maxBackoffMs: n('GEMINI_BACKOFF_MAX_MS', 15 * 60_000) };
}

const g = globalThis as unknown as { __geminiLimiter?: LimiterState };
export const limiter = { get: () => (g.__geminiLimiter ??= newLimiterState()), set: (s: LimiterState) => { g.__geminiLimiter = s; } };
