/**
 * Jupiter Swap API V2 (Meta-Aggregator) client: GET /order + POST /execute at https://api.jup.ag/swap/v2.
 * - x-api-key from JUPITER_API_KEY (read at call time). Keyless works at 0.5 RPS; a free key is 1 RPS.
 * - Two token buckets: the MAIN bucket (order, price) and a separate EXECUTE bucket (Keyless 20 / Free 50 RPS).
 * - 429s back off until x-ratelimit-reset (or 5 s). Pure helpers are exported for tests.
 * Docs: https://developers.jup.ag/docs/swap/order-and-execute.md
 */
export const JUP_SWAP_BASE = () => (process.env.JUPITER_SWAP_BASE || 'https://api.jup.ag/swap/v2').replace(/\/$/, '');
export const JUP_PRICE_BASE = () => (process.env.JUPITER_PRICE_BASE || 'https://api.jup.ag/price/v3').replace(/\/$/, '');
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export function jupiterKey(env: Record<string, string | undefined> = process.env): string | null {
  const k = env.JUPITER_API_KEY?.trim();
  return k && !k.startsWith('your_') ? k : null;
}
/** Requests per second for a bucket, from the plan implied by the key (overridable). */
export function bucketRps(kind: 'main' | 'execute', env: Record<string, string | undefined> = process.env): number {
  const keyed = !!jupiterKey(env);
  if (kind === 'main') { const o = Number(env.JUPITER_RPS); return Number.isFinite(o) && o > 0 ? o : keyed ? 1 : 0.5; }
  const o = Number(env.JUPITER_EXECUTE_RPS); return Number.isFinite(o) && o > 0 ? o : keyed ? 50 : 20;
}

/** Interval limiter: one slot every 1000/rps ms; reserve() returns how long to wait (0 = now). Pure state, testable. */
export interface Limiter { nextAt: number; blockedUntil: number }
export const newLimiter = (): Limiter => ({ nextAt: 0, blockedUntil: 0 });
export function reserve(l: Limiter, rps: number, now = Date.now()): number {
  const start = Math.max(now, l.nextAt, l.blockedUntil);
  l.nextAt = start + 1000 / rps;
  return start - now;
}
export function backoffFromHeaders(l: Limiter, headers: { get(n: string): string | null }, now = Date.now()) {
  const reset = Number(headers.get('x-ratelimit-reset'));
  const until = Number.isFinite(reset) && reset > 0 ? (reset > 1e12 ? reset : reset * 1000) : now + 5000;
  l.blockedUntil = Math.max(l.blockedUntil, Math.min(until, now + 60_000));
}

const g = globalThis as unknown as { __jupLim?: { main: Limiter; execute: Limiter }; __jupStats?: { orders: number; executes: number; limited: number; errors: number; lastError: string | null } };
const lim = (g.__jupLim ??= { main: newLimiter(), execute: newLimiter() });
const stats = (g.__jupStats ??= { orders: 0, executes: 0, limited: 0, errors: 0, lastError: null });
export const jupiterStatus = () => ({ keyed: !!jupiterKey(), mainRps: bucketRps('main'), executeRps: bucketRps('execute'), base: JUP_SWAP_BASE(), ...stats });

export class JupiterRateLimited extends Error { constructor(m = 'Jupiter rate limit: try later') { super(m); this.name = 'JupiterRateLimited'; } }

/** Rate-limited fetch. maxWaitMs: give up (JupiterRateLimited) instead of queueing longer than this. */
export async function jupFetch(url: string, init: RequestInit & { bucket?: 'main' | 'execute'; maxWaitMs?: number; timeoutMs?: number } = {}): Promise<Response> {
  const bucket = init.bucket ?? 'main';
  const l = lim[bucket];
  const wait = Math.max(Math.max(0, l.blockedUntil - Date.now()), Math.max(0, l.nextAt - Date.now()));
  if (init.maxWaitMs !== undefined && wait > init.maxWaitMs) { stats.limited++; throw new JupiterRateLimited(); }
  const w = reserve(l, bucketRps(bucket));
  if (w > 0) await new Promise((r) => setTimeout(r, w));
  const key = jupiterKey();
  const headers = { accept: 'application/json', ...(init.headers as Record<string, string> | undefined), ...(key ? { 'x-api-key': key } : {}) };
  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(init.timeoutMs ?? 12_000), cache: 'no-store' });
  if (res.status === 429) { backoffFromHeaders(l, res.headers); stats.limited++; throw new JupiterRateLimited(); }
  if (res.status === 401) { stats.errors++; stats.lastError = 'Jupiter 401: invalid JUPITER_API_KEY'; }
  return res;
}

export interface OrderParams { inputMint: string; outputMint: string; amount: bigint | string | number; taker?: string | null; slippageBps?: number | null }
export interface JupOrder {
  requestId: string; inAmount: string; outAmount: string; otherAmountThreshold: string | null; router: string; mode: string; swapType: string | null;
  feeBps: number; platformFeeBps: number | null; feeMint: string | null; priceImpactPct: number; slippageBps: number | null;
  inUsdValue: number | null; outUsdValue: number | null; transaction: string | null; gasless: boolean; lastValidBlockHeight: number | null;
  errorCode: number | null; errorMessage: string | null;
}

export function orderUrl(p: OrderParams, base = JUP_SWAP_BASE()): string {
  const q = new URLSearchParams({ inputMint: p.inputMint, outputMint: p.outputMint, amount: String(p.amount) });
  if (p.taker) q.set('taker', p.taker);
  if (p.slippageBps !== undefined && p.slippageBps !== null) q.set('slippageBps', String(Math.round(p.slippageBps)));
  return `${base}/order?${q}`;
}

/** Normalise a /order JSON body (pure). */
export function parseOrder(j: Record<string, unknown>): JupOrder {
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const pf = (j.platformFee ?? null) as { feeBps?: number; feeMint?: string } | null;
  return {
    requestId: String(j.requestId ?? ''), inAmount: String(j.inAmount ?? '0'), outAmount: String(j.outAmount ?? '0'),
    otherAmountThreshold: j.otherAmountThreshold != null ? String(j.otherAmountThreshold) : null,
    router: String(j.router ?? 'unknown'), mode: String(j.mode ?? 'unknown'), swapType: j.swapType ? String(j.swapType) : null,
    feeBps: Number(j.feeBps ?? pf?.feeBps ?? 0), platformFeeBps: pf?.feeBps ?? null, feeMint: (j.feeMint as string) ?? pf?.feeMint ?? null,
    priceImpactPct: Math.abs(Number(j.priceImpactPct ?? 0)) || 0, slippageBps: n(j.slippageBps),
    inUsdValue: n(j.inUsdValue), outUsdValue: n(j.outUsdValue),
    transaction: j.transaction === undefined ? null : (j.transaction as string | null),
    gasless: !!j.gasless, lastValidBlockHeight: n(j.lastValidBlockHeight),
    errorCode: n(j.errorCode), errorMessage: (j.errorMessage as string) ?? null,
  };
}

const ORDER_ERRORS: Record<'aggregator' | 'jupiterz', Record<number, string>> = {
  aggregator: { 1: 'insufficient funds (taker lacks input token balance)', 2: 'insufficient SOL for gas', 3: 'swap below minimum for gasless' },
  jupiterz: { 1: 'insufficient balance to fund the swap', 2: 'missing associated token account', 3: 'quote could not be built into a transaction' },
};
/** Describe an /order errorCode, matching on router + code (the docs say never to match the message string). */
export function describeOrderError(router: string, code: number | null): string {
  const fam = router === 'jupiterz' ? 'jupiterz' : 'aggregator';
  return (code !== null && ORDER_ERRORS[fam][code]) || `order error ${code ?? 'unknown'}`;
}
/** Whether an order can be signed: with a taker, `transaction` must be a non-empty string. */
export function orderTxProblem(o: JupOrder, hadTaker: boolean): string | null {
  if (!(Number(o.outAmount) > 0)) return 'no route';
  if (!hadTaker) return null;                          // quote-only: transaction is null by design
  if (o.transaction === '') return `[${o.router}] ${describeOrderError(o.router, o.errorCode)}`;
  if (!o.transaction) return 'no transaction returned';
  return null;
}

export const EXECUTE_CODES: Record<number, string> = {
  0: 'success', [-1]: 'missing cached order (requestId not found or expired)', [-2]: 'invalid signed transaction', [-3]: 'invalid message bytes',
  [-1000]: 'aggregator: failed to land', [-1001]: 'aggregator: unknown error', [-1002]: 'aggregator: invalid transaction', [-1003]: 'aggregator: transaction not fully signed',
  [-1004]: 'aggregator: invalid block height', [-1005]: 'aggregator: transaction expired before it landed',
  [-2000]: 'RFQ: failed to land', [-2001]: 'RFQ: unknown error', [-2002]: 'RFQ: invalid payload', [-2003]: 'RFQ: quote expired', [-2004]: 'RFQ: swap rejected',
};
/** Codes where a fresh /order + re-sign + /execute is the right move. */
export const RETRYABLE_EXECUTE = new Set([-1, -1000, -1004, -1005, -2000, -2003]);
export const describeExecute = (code: number) => EXECUTE_CODES[code] ?? `execute error ${code}`;

export interface JupExecute { status: 'Success' | 'Failed'; signature: string | null; code: number; totalInputAmount: string | null; totalOutputAmount: string | null; inputAmountResult: string | null; outputAmountResult: string | null; error: string | null }
export function parseExecute(j: Record<string, unknown>): JupExecute {
  return {
    status: j.status === 'Success' ? 'Success' : 'Failed', signature: (j.signature as string) || null, code: Number(j.code ?? (j.status === 'Success' ? 0 : -1001)),
    totalInputAmount: j.totalInputAmount != null ? String(j.totalInputAmount) : null, totalOutputAmount: j.totalOutputAmount != null ? String(j.totalOutputAmount) : null,
    inputAmountResult: j.inputAmountResult != null ? String(j.inputAmountResult) : null, outputAmountResult: j.outputAmountResult != null ? String(j.outputAmountResult) : null,
    error: (j.error as string) ?? null,
  };
}

export async function getOrder(p: OrderParams, opts: { maxWaitMs?: number } = {}): Promise<JupOrder> {
  const res = await jupFetch(orderUrl(p), { maxWaitMs: opts.maxWaitMs });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) { stats.errors++; stats.lastError = `/order HTTP ${res.status}: ${String(body.error ?? body.errorMessage ?? '').slice(0, 120)}`; throw new Error(`jupiter /order HTTP ${res.status}${body.error ? `: ${body.error}` : ''}`); }
  stats.orders++;
  return parseOrder(body);
}

export async function executeOrder(signedTransaction: string, requestId: string): Promise<JupExecute> {
  const res = await jupFetch(`${JUP_SWAP_BASE()}/execute`, { method: 'POST', bucket: 'execute', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedTransaction, requestId }), timeoutMs: 60_000 });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && !('code' in body)) { stats.errors++; throw new Error(`jupiter /execute HTTP ${res.status}`); }
  stats.executes++;
  return parseExecute(body);
}

/** Expected Jupiter fee for a token (Meta-Aggregator platform fee table): 50 bps if the token is < 24 h old, else 10 bps. */
export function expectedFeeBps(ageHours: number | null | undefined, env: Record<string, string | undefined> = process.env): number {
  const young = Number(env.JUP_NEW_TOKEN_FEE_BPS ?? 50), base = Number(env.JUP_DEFAULT_FEE_BPS ?? 10);
  return ageHours !== null && ageHours !== undefined && ageHours < 24 ? young : base;
}
/** Composite penalty for round-trip fees above the 2×10 bps baseline: (2·fee − 20) / 2000 → 0.04 for a 50 bps token. */
export function feePenalty(feeBps: number): number { return Math.max(0, 2 * feeBps - 20) / 2000; }

/** Jupiter Price API V3 (USD), up to 50 mints per call, through the MAIN bucket. Missing mints are omitted. */
export async function jupPrices(mints: string[], opts: { maxWaitMs?: number } = {}): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < mints.length; i += 50) {
    const res = await jupFetch(`${JUP_PRICE_BASE()}?ids=${mints.slice(i, i + 50).join(',')}`, { maxWaitMs: opts.maxWaitMs ?? 8000, timeoutMs: 8000 });
    if (!res.ok) continue;
    const j = (await res.json().catch(() => ({}))) as Record<string, { usdPrice?: number }>;
    for (const [m, v] of Object.entries(j)) if (v && Number(v.usdPrice) > 0) out[m] = Number(v.usdPrice);
  }
  return out;
}
