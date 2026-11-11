/**
 * Fast on-chain price for open positions (flag FAST_PRICE_WS=on, default off).
 *
 * Why: the Helius WebSocket fast path used `accountSubscribe` on the pool account and then re-priced through
 * Jupiter Price v3 (shared, rate-limited bucket). PumpSwap pools keep their reserves in separate vault token
 * accounts, so the pool account itself does not change on a swap and that subscription never fires for them;
 * exits fell back to the ~3 s HTTP poll. With FAST_PRICE_WS=on the WebSocket uses `logsSubscribe` with
 * `mentions: [pool]` (fires on every swap for every DEX type) and prices the token straight from that swap's
 * pre/post token balances (one getTransaction call), with Jupiter Price as the fallback.
 *
 * Safety: a fast price that jumps more than FAST_PRICE_MAX_JUMP_PCT from the last known price is not trusted on
 * its own (the caller falls back to Jupiter / the poll), so a mis-parsed transaction cannot trigger a stop.
 */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const USD_QUOTES: Record<string, true> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: true, // USDC
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: true, // USDT
};

export function fastPriceOn(env: Record<string, string | undefined> = process.env): boolean {
  return (env.FAST_PRICE_WS ?? '').trim().toLowerCase() === 'on';
}
export function fastPriceParams(env: Record<string, string | undefined> = process.env) {
  const n = (k: string, d: number) => { const v = Number(env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  return {
    maxJumpPct: n('FAST_PRICE_MAX_JUMP_PCT', 35),
    txTimeoutMs: n('FAST_PRICE_TX_TIMEOUT_MS', 4000),
    retryDelayMs: n('FAST_PRICE_TX_RETRY_MS', 700),
    wsStaleMs: n('WS_STALE_MS', 90_000),
  };
}

interface TokenBal { owner?: string; mint: string; uiTokenAmount: { amount: string; decimals: number } }
export interface TxMetaLike { err?: unknown; preTokenBalances?: TokenBal[] | null; postTokenBalances?: TokenBal[] | null }

/**
 * Price of `baseMint` in USD from one swap's token-balance changes (pure). The pool's vault owner is the owner whose
 * base and quote balances moved in opposite directions; with several (pool + trader), the one holding the most base
 * after the swap (the pool's reserves) wins. Price = |Δquote| / |Δbase| converted to USD (WSOL via solUsd, USDC/USDT = 1).
 */
export function priceFromSwapMeta(meta: TxMetaLike | null | undefined, baseMint: string, solUsd: number): { priceUsd: number; owner: string; quoteMint: string } | null {
  if (!meta || meta.err) return null;
  const ui = (b: TokenBal) => Number(b.uiTokenAmount.amount) / 10 ** b.uiTokenAmount.decimals;
  const acc = new Map<string, { dBase: number; postBase: number; dQuote: Map<string, number> }>();
  const touch = (owner: string) => { let a = acc.get(owner); if (!a) { a = { dBase: 0, postBase: 0, dQuote: new Map() }; acc.set(owner, a); } return a; };
  const isQuote = (m: string) => m === WSOL_MINT || !!USD_QUOTES[m];
  for (const [list, sign] of [[meta.preTokenBalances ?? [], -1], [meta.postTokenBalances ?? [], 1]] as const) {
    for (const b of list) {
      if (!b.owner) continue;
      if (b.mint === baseMint) { const a = touch(b.owner); a.dBase += sign * ui(b); if (sign > 0) a.postBase += ui(b); }
      else if (isQuote(b.mint)) { const a = touch(b.owner); a.dQuote.set(b.mint, (a.dQuote.get(b.mint) ?? 0) + sign * ui(b)); }
    }
  }
  let best: { priceUsd: number; owner: string; quoteMint: string; postBase: number } | null = null;
  for (const [owner, a] of acc) {
    if (!(Math.abs(a.dBase) > 0)) continue;
    for (const [qm, dq] of a.dQuote) {
      if (!(Math.abs(dq) > 0) || Math.sign(dq) === Math.sign(a.dBase)) continue;
      const qUsd = qm === WSOL_MINT ? solUsd : 1;
      if (!(qUsd > 0)) continue;
      const priceUsd = (Math.abs(dq) / Math.abs(a.dBase)) * qUsd;
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;
      if (!best || a.postBase > best.postBase) best = { priceUsd, owner, quoteMint: qm, postBase: a.postBase };
    }
  }
  return best ? { priceUsd: best.priceUsd, owner: best.owner, quoteMint: best.quoteMint } : null;
}

/** Accept a fast price only if it is within maxJumpPct of the last known price (or there is none). Pure. */
export function acceptFastPrice(fast: number, last: number | null | undefined, maxJumpPct: number): boolean {
  if (!(fast > 0) || !Number.isFinite(fast)) return false;
  if (!last || !(last > 0)) return true;
  return Math.abs(fast / last - 1) * 100 <= maxJumpPct;
}

export type RpcFn = <T>(method: string, params: unknown, opts?: { timeoutMs?: number }) => Promise<T>;

/** Fetch one swap transaction and price `mint` from it. Retries once (a `processed` log can precede `confirmed` tx data). */
export async function fastPriceFromSignature(sig: string, mint: string, solUsd: number, deps: { rpc?: RpcFn; sleep?: (ms: number) => Promise<void> } = {}): Promise<number | null> {
  const p = fastPriceParams();
  const rpc: RpcFn = deps.rpc ?? (async (m, params, o) => (await import('./rpc-pool')).rpcCall(m, params, o));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const tx = await rpc<{ meta?: TxMetaLike } | null>('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }], { timeoutMs: p.txTimeoutMs });
      if (tx?.meta) return priceFromSwapMeta(tx.meta, mint, solUsd)?.priceUsd ?? null;
    } catch { /* fall through to retry / null */ }
    if (attempt === 0) await sleep(p.retryDelayMs);
  }
  return null;
}

/** Per-key debounce that keeps the LATEST event (trailing), so a burst of swaps still ends with a check on the last one. */
export class TrailingDebounce<T> {
  private last = new Map<string, number>();
  private pending = new Map<string, T>();
  private timers = new Map<string, NodeJS.Timeout>();
  constructor(private ms: number, private run: (key: string, v: T) => void, private now: () => number = Date.now) {}
  push(key: string, v: T): void {
    const t = this.now();
    const since = t - (this.last.get(key) ?? -Infinity);
    if (since >= this.ms && !this.timers.has(key)) { this.last.set(key, t); this.run(key, v); return; }
    this.pending.set(key, v);
    if (this.timers.has(key)) return;
    const timer = setTimeout(() => {
      this.timers.delete(key);
      const pv = this.pending.get(key); this.pending.delete(key);
      if (pv !== undefined) { this.last.set(key, this.now()); this.run(key, pv); }
    }, Math.max(0, this.ms - since));
    timer.unref?.();
    this.timers.set(key, timer);
  }
}
