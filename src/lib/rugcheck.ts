/**
 * RugCheck client (FluxRPC-issued keys). Auth: `X-API-KEY` header (preferred per FluxRPC docs; `?key=` also works).
 * The Shield key is FluxRPC's public, per-IP-limited key for browser use. The server API rejects it, so it's used only as a
 * last authenticated attempt before falling back to the unauthenticated public endpoint.
 * No key values are ever logged or returned; status() exposes only booleans/mode names.
 */
export const RUGCHECK_PUBLIC_BASE = 'https://api.rugcheck.xyz/v1';

export interface RugcheckConfig { baseUrl: string; apiKey: string | null; shieldKey: string | null }

const real = (v?: string) => (v && v.trim() && !v.startsWith('your_') ? v.trim() : null);

/** Normalise RUGCHECK_API_URL: strip any `?key=` (used as the key if RUGCHECK_API_KEY is unset) and ensure a /v1 path. */
export function rugcheckConfig(env: Record<string, string | undefined> = process.env): RugcheckConfig {
  let apiKey = real(env.RUGCHECK_API_KEY);
  let baseUrl = RUGCHECK_PUBLIC_BASE;
  const raw = real(env.RUGCHECK_API_URL);
  if (raw) {
    try {
      const u = new URL(raw);
      const qk = u.searchParams.get('key');
      if (qk && !apiKey) apiKey = qk;
      let path = u.pathname.replace(/\/+$/, '');
      if (!/\/v1$/.test(path)) path += '/v1';
      baseUrl = `${u.origin}${path}`;
    } catch { /* invalid URL: keep public base */ }
  }
  return { baseUrl, apiKey, shieldKey: real(env.RUGCHECK_SHIELD_KEY) };
}

export type RugcheckAuthMode = 'api_key' | 'shield_key' | 'public';
interface State { authBadUntil: number; shieldBadUntil: number; backoffUntil: number; lastMode: RugcheckAuthMode | null; lastStatus: number | null; calls: number; fallbacks: number }
const g = globalThis as unknown as { __rcState?: State };
const st: State = (g.__rcState ??= { authBadUntil: 0, shieldBadUntil: 0, backoffUntil: 0, lastMode: null, lastStatus: null, calls: 0, fallbacks: 0 });
const AUTH_RETRY_MS = 10 * 60_000;

export function resetRugcheckState() { Object.assign(st, { authBadUntil: 0, shieldBadUntil: 0, backoffUntil: 0, lastMode: null, lastStatus: null, calls: 0, fallbacks: 0 }); }

/** Ordered attempts for a request: authenticated first (if keys are configured and not recently rejected), public last. */
export function attemptPlan(cfg: RugcheckConfig, now = Date.now()): { mode: RugcheckAuthMode; base: string; headers: Record<string, string> }[] {
  const plan: { mode: RugcheckAuthMode; base: string; headers: Record<string, string> }[] = [];
  if (cfg.apiKey && now >= st.authBadUntil) plan.push({ mode: 'api_key', base: cfg.baseUrl, headers: { 'X-API-KEY': cfg.apiKey } });
  if (cfg.shieldKey && now >= st.shieldBadUntil) plan.push({ mode: 'shield_key', base: cfg.baseUrl, headers: { 'X-API-KEY': cfg.shieldKey } });
  plan.push({ mode: 'public', base: RUGCHECK_PUBLIC_BASE, headers: {} });
  return plan;
}

/** GET a RugCheck path (e.g. `/tokens/<mint>/report`) with auth fallback. Returns parsed JSON or null. */
export async function rugcheckGet<T>(path: string, opts: { cfg?: RugcheckConfig; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<T | null> {
  const cfg = opts.cfg ?? rugcheckConfig();
  const f = opts.fetchImpl ?? fetch;
  const now = Date.now();
  if (now < st.backoffUntil) return null;
  const plan = attemptPlan(cfg, now);
  for (let i = 0; i < plan.length; i++) {
    const a = plan[i];
    try {
      st.calls++;
      const res = await f(`${a.base}${path}`, { headers: { accept: 'application/json', ...a.headers }, signal: AbortSignal.timeout(opts.timeoutMs ?? 12000), cache: 'no-store' } as RequestInit);
      st.lastStatus = res.status;
      if (res.ok) { st.lastMode = a.mode; if (i > 0) st.fallbacks++; return (await res.json()) as T; }
      if (res.status === 401 || res.status === 403) {
        if (a.mode === 'api_key') st.authBadUntil = Date.now() + AUTH_RETRY_MS;
        if (a.mode === 'shield_key') st.shieldBadUntil = Date.now() + AUTH_RETRY_MS;
        continue; // try the next credential / public
      }
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'));
        if (a.mode === 'public') { st.backoffUntil = Date.now() + (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000); return null; }
        continue;
      }
      if (res.status === 404 || res.status === 400) return null; // not a credential problem
      continue; // 5xx: try the next attempt
    } catch {
      continue; // network/timeout: try the next attempt
    }
  }
  return null;
}

export function rugcheckStatus(cfg: RugcheckConfig = rugcheckConfig()) {
  const now = Date.now();
  return {
    hasApiKey: !!cfg.apiKey, hasShieldKey: !!cfg.shieldKey, customBase: cfg.baseUrl !== RUGCHECK_PUBLIC_BASE,
    apiKeyRejected: now < st.authBadUntil, lastMode: st.lastMode, lastStatus: st.lastStatus, calls: st.calls, publicFallbacks: st.fallbacks,
  };
}
