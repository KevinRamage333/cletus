/**
 * Live (real-SOL) exit and fill helpers. Pure functions so the sell path can be tested
 * without an RPC or Jupiter.
 *
 * Why this exists: a failed live sell used to retry forever at the global slippage
 * (which every successful scan decayed back down), and with max 1 open position the bot
 * could lock itself out of new trades for good.
 */

/** Exits that protect capital: widen slippage on each failed attempt so the position actually gets out. */
export const PROTECTIVE_EXIT_REASONS = new Set(['stop_loss', 'kill_switch', 'stale_price', 'break_even', 'trailing_stop', 'time_exit', 'stale_exit', 'dev_dump', 'whale_exit']);

export const DEFAULT_EXIT_SLIPPAGE_LADDER = [300, 800, 1500, 3000];

export function parseLadder(raw: string | undefined, fallback = DEFAULT_EXIT_SLIPPAGE_LADDER): number[] {
  if (!raw) return fallback;
  const v = raw.split(',').map((x) => Math.round(Number(x.trim()))).filter((x) => Number.isFinite(x) && x > 0);
  return v.length ? v : fallback;
}

/**
 * Slippage for a live sell. Protective exits climb the ladder by failed-attempt count
 * (attempt 0 = first try). Other exits (take profit) use the normal slippage, but still
 * widen along the ladder once they have failed.
 */
export function exitSlippageBps(reason: string, failedAttempts: number, baseBps: number, ladder = DEFAULT_EXIT_SLIPPAGE_LADDER): number {
  const protective = PROTECTIVE_EXIT_REASONS.has(reason) || reason.startsWith('flow_') || reason.includes('whale') || reason.includes('dev');
  const step = ladder[Math.min(Math.max(0, failedAttempts), ladder.length - 1)];
  if (protective) return Math.max(baseBps, step);
  return failedAttempts === 0 ? baseBps : Math.max(baseBps, step);
}

export function isNoRouteError(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes('no route') || m.includes('could not find any route') || m.includes('no_route') || m.includes('route not found') || m.includes('insufficient liquidity') || m.includes('token_not_tradable') || m.includes('not tradable');
}

export interface SellFailureState { failures: number; noRouteFailures: number; nextAttemptAt: number }

/** Backoff between failed live sells: 5s, 10s, 20s, 40s, then every 60s. */
export function sellBackoffMs(failures: number): number {
  return Math.min(60_000, 5_000 * 2 ** Math.max(0, failures - 1));
}

export function recordSellFailure(prev: SellFailureState | undefined, msg: string, now = Date.now()): SellFailureState {
  const failures = (prev?.failures ?? 0) + 1;
  const noRouteFailures = (prev?.noRouteFailures ?? 0) + (isNoRouteError(msg) ? 1 : 0);
  return { failures, noRouteFailures, nextAttemptAt: now + sellBackoffMs(failures) };
}

/**
 * After this many failures the position is written off in the book (tokens, if any, stay in the
 * wallet) so the single position slot frees up. No-route failures write off sooner.
 */
export function shouldWriteOff(s: SellFailureState, maxFailures: number, maxNoRoute: number): boolean {
  return s.failures >= maxFailures || s.noRouteFailures >= maxNoRoute;
}

/**
 * Token amount actually received by a live buy. Prefer the swap's reported outAmount (raw units)
 * with the mint's decimals; fall back to an on-chain balance read. Returns null when neither is
 * usable, so the caller never stores a 0-token position.
 */
export function liveFillTokenAmount(outAmountRaw: string | undefined | null, decimals: number | null, balanceRaw: bigint | null): number | null {
  if (decimals === null || !Number.isFinite(decimals) || decimals < 0) return null;
  const out = outAmountRaw ? Number(outAmountRaw) : 0;
  if (Number.isFinite(out) && out > 0) return out / 10 ** decimals;
  if (balanceRaw !== null && balanceRaw > 0n) return Number(balanceRaw) / 10 ** decimals;
  return null;
}

/** Exit price per token, safe against a zero/garbage token amount. */
export function safeExitPrice(proceedsUsd: number, tokenAmount: number, fallbackPrice: number): number {
  return tokenAmount > 0 && Number.isFinite(proceedsUsd) ? proceedsUsd / tokenAmount : fallbackPrice;
}

/** True when the last price for a live position is older than maxAgeMs. */
export function isPriceStale(priceAt: number | undefined, now: number, maxAgeMs: number): boolean {
  if (!(maxAgeMs > 0) || priceAt === undefined) return false;
  return now - priceAt > maxAgeMs;
}
