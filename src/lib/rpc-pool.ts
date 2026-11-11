/**
 * RPC failover: Helius primary, FluxRPC (BACKUP_RPC_URL) backup.
 * Switches to the backup after consecutive errors/timeouts or sustained high latency, keeps
 * health-checking both with getHealth, and switches back once the primary is healthy again.
 * URLs contain API keys: they are never logged or sent to the browser (only endpoint names are).
 * The state machine is pure and unit-tested; the I/O wrapper is below it.
 */
export interface EndpointState { name: string; consecutiveFailures: number; latencyEwmaMs: number | null; lastError: string | null; lastCheckAt: number | null; healthyStreak: number }
export interface PoolState { active: number; endpoints: EndpointState[]; switches: number; lastSwitchAt: number | null; lastSwitchReason: string | null }
export interface PoolParams { maxFailures: number; maxLatencyMs: number; recoverChecks: number; ewmaAlpha: number }

export const DEFAULT_POOL_PARAMS: PoolParams = { maxFailures: 2, maxLatencyMs: 1500, recoverChecks: 3, ewmaAlpha: 0.3 };

export function newPool(names: string[]): PoolState {
  return { active: 0, endpoints: names.map((name) => ({ name, consecutiveFailures: 0, latencyEwmaMs: null, lastError: null, lastCheckAt: null, healthyStreak: 0 })), switches: 0, lastSwitchAt: null, lastSwitchReason: null };
}

const unhealthy = (e: EndpointState, p: PoolParams) => e.consecutiveFailures >= p.maxFailures || (e.latencyEwmaMs !== null && e.latencyEwmaMs > p.maxLatencyMs);

/** Record one call/health-check result and apply switching rules. Returns a new state. */
export function recordResult(s: PoolState, idx: number, r: { ok: boolean; latencyMs: number; error?: string; isHealthCheck?: boolean }, p: PoolParams = DEFAULT_POOL_PARAMS, now = Date.now()): PoolState {
  const endpoints = s.endpoints.map((e, i) => {
    if (i !== idx) return e;
    const lat = r.ok ? (e.latencyEwmaMs === null ? r.latencyMs : e.latencyEwmaMs * (1 - p.ewmaAlpha) + r.latencyMs * p.ewmaAlpha) : e.latencyEwmaMs;
    const failures = r.ok ? 0 : e.consecutiveFailures + 1;
    const next = { ...e, consecutiveFailures: failures, latencyEwmaMs: lat, lastError: r.ok ? e.lastError : r.error ?? 'error', lastCheckAt: now };
    next.healthyStreak = r.ok && !unhealthy(next, p) ? (r.isHealthCheck ? e.healthyStreak + 1 : e.healthyStreak) : 0;
    return next;
  });
  let out: PoolState = { ...s, endpoints };
  const act = endpoints[out.active];
  // Fail over away from an unhealthy active endpoint to the first healthy alternative.
  if (unhealthy(act, p)) {
    const alt = endpoints.findIndex((e, i) => i !== out.active && !unhealthy(e, p));
    if (alt >= 0) out = { ...out, active: alt, switches: out.switches + 1, lastSwitchAt: now, lastSwitchReason: `${act.name} ${act.consecutiveFailures >= p.maxFailures ? `failed ${act.consecutiveFailures}x (${act.lastError})` : `latency ${Math.round(act.latencyEwmaMs ?? 0)}ms`}` };
  }
  // Switch back to the primary (index 0) once it has passed `recoverChecks` consecutive health checks.
  if (out.active !== 0 && !unhealthy(endpoints[0], p) && endpoints[0].healthyStreak >= p.recoverChecks) {
    out = { ...out, active: 0, switches: out.switches + 1, lastSwitchAt: now, lastSwitchReason: `${endpoints[0].name} recovered` };
  }
  return out;
}

// ─── I/O ──────────────────────────────────────────────────────────────────────

export interface Endpoint { name: string; url: string }

export function configuredEndpoints(env: Record<string, string | undefined> = process.env): Endpoint[] {
  const ok = (v?: string) => (v && !v.includes('your_') ? v.trim() : null);
  const list: Endpoint[] = [];
  const helius = ok(env.HELIUS_RPC_URL) ?? (ok(env.HELIUS_API_KEY) ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}` : null);
  if (helius) list.push({ name: 'helius', url: helius });
  const backup = ok(env.BACKUP_RPC_URL);
  if (backup) list.push({ name: /fluxrpc/i.test(backup) ? 'fluxrpc' : 'backup', url: backup });
  const pub = ok(env.RPC_URL) ?? 'https://api.mainnet-beta.solana.com';
  if (!list.length || env.RPC_INCLUDE_PUBLIC === 'true') list.push({ name: 'public', url: pub });
  return list;
}

const g = globalThis as unknown as { __rpcPool?: { endpoints: Endpoint[]; state: PoolState; timer?: NodeJS.Timeout } };
function pool() {
  if (!g.__rpcPool) { const eps = configuredEndpoints(); g.__rpcPool = { endpoints: eps, state: newPool(eps.map((e) => e.name)) }; }
  return g.__rpcPool;
}
export function poolParams(env: Record<string, string | undefined> = process.env): PoolParams {
  const n = (k: string, d: number) => (env[k] && Number.isFinite(Number(env[k])) ? Number(env[k]) : d);
  return { maxFailures: n('RPC_MAX_FAILURES', 2), maxLatencyMs: n('RPC_MAX_LATENCY_MS', 1500), recoverChecks: n('RPC_RECOVER_CHECKS', 3), ewmaAlpha: 0.3 };
}

export function activeRpc(): Endpoint { const p = pool(); return p.endpoints[p.state.active]; }
export function rpcStatus() {
  const p = pool();
  return { active: p.endpoints[p.state.active]?.name ?? 'none', switches: p.state.switches, lastSwitchAt: p.state.lastSwitchAt ? new Date(p.state.lastSwitchAt) : null, lastSwitchReason: p.state.lastSwitchReason,
    endpoints: p.state.endpoints.map((e) => ({ name: e.name, latencyMs: e.latencyEwmaMs === null ? null : Math.round(e.latencyEwmaMs), failures: e.consecutiveFailures, lastError: e.lastError })) };
}
function record(idx: number, r: { ok: boolean; latencyMs: number; error?: string; isHealthCheck?: boolean }) {
  const p = pool(); const before = p.state.active;
  p.state = recordResult(p.state, idx, r, poolParams());
  if (p.state.active !== before) console.log(`[cletus] RPC failover: ${p.endpoints[before].name} -> ${p.endpoints[p.state.active].name} (${p.state.lastSwitchReason})`);
}

async function call<T>(url: string, method: string, params: unknown, timeoutMs: number): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message ?? 'rpc error'), { rpcLevel: true });
  return j.result as T;
}

/** JSON-RPC with failover: try the active endpoint, then the others. Method-level RPC errors don't count as outages. */
export async function rpcCall<T>(method: string, params: unknown, opts: { timeoutMs?: number; only?: string } = {}): Promise<T> {
  const p = pool();
  const order = [p.state.active, ...p.endpoints.map((_, i) => i).filter((i) => i !== p.state.active)].filter((i) => !opts.only || p.endpoints[i].name === opts.only);
  let last: Error | null = null;
  for (const i of order) {
    const t0 = Date.now();
    try {
      const res = await call<T>(p.endpoints[i].url, method, params, opts.timeoutMs ?? 8000);
      record(i, { ok: true, latencyMs: Date.now() - t0 });
      return res;
    } catch (e) {
      last = e as Error;
      if ((e as { rpcLevel?: boolean }).rpcLevel) throw last; // the node answered; the request itself is bad
      record(i, { ok: false, latencyMs: Date.now() - t0, error: (e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message.slice(0, 80) });
    }
  }
  throw last ?? new Error('no RPC endpoint');
}

/** Health-check every endpoint (getHealth) on an interval; drives failover and switch-back. */
export function startRpcHealthChecks(intervalMs = Number(process.env.RPC_HEALTH_INTERVAL_MS ?? 20_000)) {
  const p = pool();
  if (p.timer) return;
  const run = async () => {
    await Promise.all(p.endpoints.map(async (e, i) => {
      const t0 = Date.now();
      try { await call(e.url, 'getHealth', [], 5000); record(i, { ok: true, latencyMs: Date.now() - t0, isHealthCheck: true }); }
      catch (err) { record(i, { ok: false, latencyMs: Date.now() - t0, error: (err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message.slice(0, 80), isHealthCheck: true }); }
    }));
  };
  void run();
  p.timer = setInterval(() => void run(), intervalMs);
}
