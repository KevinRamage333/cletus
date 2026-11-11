/**
 * Backtest replay core (pure; unit-tested in tests/backtest.test.ts).
 *
 * Rebuilds the DexScreener-style pair snapshot the live scanner would have seen at the CLOSE of a historical
 * 5-minute candle, using ONLY candles at or before that moment (no lookahead), then feeds it through the real
 * rankCandidates()/compositeScore() code. Trades are simulated with the real exitDecision()/partialTakeProfit()
 * rules and the real fill/fee models (simFillPrice, expectedFeeBps).
 *
 * Fields that GeckoTerminal OHLCV does not carry are PROXIES, documented in docs/BACKTEST.md:
 *  - txn counts (velocitySurge, microCapHeat): buys/sells from the candle close-location value, counts from volume.
 *  - liquidity: constant-product back-projection liq_t = liq_now * sqrt(p_t / p_now) (exact if no LP adds/removes).
 *  - market cap: close * supply, supply = fdv_now / price_now (constant supply).
 */
import type { DexPair } from '../dexscreener';
import { exitDecision, partialTakeProfit, type ExitParams, type TpRung } from '../exits';
import { simFillPrice } from '../fills';

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number } // t = bucket start, unix seconds
export interface PoolMeta { pool: string; mint: string; symbol: string; dex: string; supply: number; createdAtMs: number | null; liqNow: number | null; priceNow: number }
export const BAR_SEC = 300;

/** Index of the last bar whose bucket starts at or before `tSec` (bars ascending). -1 if none. */
export function lastIdxAtOrBefore(bars: Bar[], tSec: number): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].t <= tSec) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

/** Prefix sums of volume for O(1) window sums. */
export function volumePrefix(bars: Bar[]): Float64Array {
  const p = new Float64Array(bars.length + 1);
  for (let i = 0; i < bars.length; i++) p[i + 1] = p[i] + (bars[i].v || 0);
  return p;
}

export function liquidityAt(meta: PoolMeta, price: number): number | undefined {
  if (!(meta.liqNow && meta.liqNow > 0) || !(meta.priceNow > 0) || !(price > 0)) return undefined;
  return meta.liqNow * Math.sqrt(price / meta.priceNow);
}

/**
 * Snapshot at the close of bar i (decision time = bars[i].t + 300 s). Uses bars[0..i] only.
 * Returns null during warm-up (< 6 h of history) because h6 would be undefined.
 */
export function snapshotAt(bars: Bar[], i: number, meta: PoolMeta, prefix = volumePrefix(bars), warmupSec = 6 * 3600): DexPair | null {
  const b = bars[i]; if (!b) return null;
  const now = b.t + BAR_SEC;
  if (now - bars[0].t < warmupSec) return null;
  const at = (secAgo: number) => { const j = lastIdxAtOrBefore(bars, now - secAgo - BAR_SEC); return j >= 0 && j <= i ? j : -1; };
  const chg = (secAgo: number) => { const j = at(secAgo); return j >= 0 ? (b.c / bars[j].c - 1) * 100 : 0; };
  const volSince = (secAgo: number) => { const j = at(secAgo); return prefix[i + 1] - prefix[j + 1]; };
  const histSec = now - bars[0].t;
  const v5 = b.v || 0, v1 = volSince(3600), v6 = volSince(6 * 3600);
  const v24raw = volSince(24 * 3600);
  const v24 = histSec >= 24 * 3600 ? v24raw : (v24raw * 24 * 3600) / histSec; // extrapolated from the past only
  // Proxy txns: close-location value as the buy share; counts scale with volume (relative values are what matter).
  const range = b.h - b.l;
  const clv = range > 0 ? (b.c - b.l) / range : 0.5;
  const n5 = Math.round(v5 / 50), n1 = Math.round(v1 / 50);
  const buys5 = Math.round(n5 * clv);
  const mcap = b.c * meta.supply;
  const liq = liquidityAt(meta, b.c);
  return {
    chainId: 'solana', dexId: meta.dex, pairAddress: meta.pool,
    baseToken: { address: meta.mint, name: meta.symbol, symbol: meta.symbol }, quoteToken: { address: '', symbol: 'SOL' },
    priceUsd: String(b.c),
    txns: { m5: { buys: buys5, sells: n5 - buys5 }, h1: { buys: Math.round(n1 / 2), sells: n1 - Math.round(n1 / 2) }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } },
    volume: { m5: v5, h1: v1, h6: v6, h24: v24 },
    priceChange: { m5: chg(BAR_SEC), h1: chg(3600), h6: chg(6 * 3600), h24: chg(24 * 3600) },
    liquidity: liq === undefined ? undefined : { usd: liq },
    fdv: mcap, marketCap: mcap,
    pairCreatedAt: meta.createdAtMs ?? undefined,
  };
}

export interface CostModel {
  feeBps: number;              // all-in Jupiter (+operator) fee per side, from expectedFeeBps()
  slippageBps: number;         // latency / MEV slippage per side on top of the AMM price impact
  stopSlippageBps: number;     // extra adverse slippage when a stop-type exit fires (fast tape)
  networkUsdPerSide: number;   // base + priority fee in USD
}
export interface TradeResult {
  entryIdx: number; exitIdx: number; entryTime: number; exitTime: number; reason: string;
  sizeUsd: number; pnlUsd: number; pnlPct: number; feesUsd: number; censored: boolean;
}

const STOPS = new Set(['stop_loss', 'trailing_stop', 'break_even']);

/**
 * Simulate one long trade decided at the close of bar `i` (entry at that close + slippage + AMM impact).
 * Intrabar path: bullish bar O→L→H→C, bearish bar O→H→L→C (stops see the low first on up bars).
 * Level exits fill at the level (or the observed price if it gapped through at the open), then pay impact/slippage.
 */
/** Optional per-bar exit checked at each bar close after the level exits (e.g. volume fade). Returns a reason to sell all. */
export type BarExitHook = (k: number, ctx: { entry: number; close: number; taken: number; openedAtSec: number }) => string | null;

export function simulateTrade(bars: Bar[], i: number, meta: PoolMeta, exitP: ExitParams, ladder: TpRung[], cost: CostModel, sizeUsd: number, datasetEndSec: number, barHook?: BarExitHook): TradeResult | null {
  const b = bars[i]; if (!b) return null;
  const t0 = b.t + BAR_SEC;
  const liq0 = liquidityAt(meta, b.c);
  const entryMid = b.c * (1 + cost.slippageBps / 10_000);
  const entry = simFillPrice('buy', entryMid, sizeUsd, liq0, 0.01);
  let tokens = sizeUsd / entry; // fees charged separately in USD (as the engine does)
  let fees = (sizeUsd * cost.feeBps) / 10_000 + cost.networkUsdPerSide;
  let proceeds = 0, highest = entry, taken = 0;
  const openedAt = new Date(t0 * 1000);
  const sell = (px: number, qty: number, stopType: boolean, liqPx: number) => {
    const mid = px * (1 - (cost.slippageBps + (stopType ? cost.stopSlippageBps : 0)) / 10_000);
    const notional = qty * mid;
    const fill = simFillPrice('sell', mid, notional, liquidityAt(meta, liqPx), 0.01);
    const usd = qty * fill;
    fees += (usd * cost.feeBps) / 10_000 + cost.networkUsdPerSide;
    proceeds += usd;
  };
  const deadlineSec = t0 + exitP.holdTimeMinutes * 60;
  for (let k = i + 1; k < bars.length; k++) {
    const x = bars[k];
    const pts: Array<[number, number, boolean]> = x.c >= x.o
      ? [[x.o, x.t, true], [x.l, x.t + 100, false], [x.h, x.t + 200, false], [x.c, x.t + 300, false]]
      : [[x.o, x.t, true], [x.h, x.t + 100, false], [x.l, x.t + 200, false], [x.c, x.t + 300, false]];
    for (const [p, ts, isOpen] of pts) {
      // Time-based exits fire at the deadline: price interpolated within the bar (unbiased vs using H or L).
      const tCheck = Math.min(ts, Math.max(deadlineSec, x.t));
      const timeHit = ts >= deadlineSec;
      const px = timeHit && !isOpen ? x.o + ((x.c - x.o) * Math.min(1, Math.max(0, (deadlineSec - x.t) / BAR_SEC))) : p;
      const reason = exitDecision({ entryPrice: entry, highestPrice: highest, openedAt }, timeHit ? px : p, exitP, new Date((timeHit ? tCheck : ts) * 1000));
      if (reason) {
        let fillPx = timeHit ? px : p;
        if (!isOpen) {
          if (reason === 'stop_loss') fillPx = Math.max(p, entry * (1 - exitP.stopLossPct / 100));
          else if (reason === 'take_profit') fillPx = Math.min(p, entry * (1 + exitP.takeProfitPct / 100));
          else if (reason === 'trailing_stop') fillPx = Math.max(p, highest * (1 - exitP.trailingStopPct / 100));
          else if (reason === 'break_even') fillPx = Math.max(p, entry);
        }
        sell(fillPx, tokens, STOPS.has(reason), fillPx);
        const pnl = proceeds - sizeUsd - fees;
        return { entryIdx: i, exitIdx: k, entryTime: t0, exitTime: ts, reason, sizeUsd, pnlUsd: pnl, pnlPct: (pnl / sizeUsd) * 100, feesUsd: fees, censored: false };
      }
      const part = partialTakeProfit({ entryPrice: entry }, p, ladder, taken, exitP.takeProfitPct);
      if (part) {
        const lvl = isOpen ? p : Math.min(p, entry * (1 + part.gainPct / 100));
        const q = tokens * part.fraction; tokens -= q; taken = part.rung;
        sell(lvl, q, false, lvl);
      }
      highest = Math.max(highest, p);
    }
    const hookReason = barHook?.(k, { entry, close: x.c, taken, openedAtSec: t0 });
    if (hookReason) {
      sell(x.c, tokens, true, x.c); // market sell into a quiet tape: pay the stop-type slippage too
      const pnl = proceeds - sizeUsd - fees;
      return { entryIdx: i, exitIdx: k, entryTime: t0, exitTime: x.t + BAR_SEC, reason: hookReason, sizeUsd, pnlUsd: pnl, pnlPct: (pnl / sizeUsd) * 100, feesUsd: fees, censored: false };
    }
  }
  // Ran out of data. If the pool simply stopped trading long before the dataset end, mark to the last close.
  const last = bars[bars.length - 1];
  const censored = datasetEndSec - (last.t + BAR_SEC) < 2 * 3600;
  if (censored) return { entryIdx: i, exitIdx: bars.length - 1, entryTime: t0, exitTime: last.t + BAR_SEC, reason: 'censored', sizeUsd, pnlUsd: 0, pnlPct: 0, feesUsd: fees, censored: true };
  sell(last.c * 0.5, tokens, true, last.c * 0.5); // dead pool: assume you dump into a thin book at half the last print
  const pnl = proceeds - sizeUsd - fees;
  return { entryIdx: i, exitIdx: bars.length - 1, entryTime: t0, exitTime: last.t + BAR_SEC, reason: 'dead_pool', sizeUsd, pnlUsd: pnl, pnlPct: (pnl / sizeUsd) * 100, feesUsd: fees, censored: false };
}

// ─── Statistics ─────────────────────────────────────────────────────────────

export function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let s = 0; s < idx.length;) {
    let e = s; while (e + 1 < idx.length && idx[e + 1][0] === idx[s][0]) e++;
    const avg = (s + e) / 2 + 1;
    for (let k = s; k <= e; k++) r[idx[k][1]] = avg;
    s = e + 1;
  }
  return r;
}
export function pearson(a: number[], b: number[]): number | null {
  const n = a.length; if (n < 3) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}
/** Spearman rank correlation = information coefficient (IC). */
export const spearman = (a: number[], b: number[]) => pearson(rank(a), rank(b));

export interface TradeStats {
  n: number; hitRate: number | null; avgWinPct: number | null; avgLossPct: number | null; expectancyPct: number | null;
  profitFactor: number | null; sharpePerTrade: number | null; totalPnlUsd: number; maxDrawdownPct: number;
}
/** Per-trade stats from net returns (pct of size) in chronological order; drawdown on a compounding-free equity curve. */
export function tradeStats(trades: Array<{ pnlPct: number; pnlUsd: number }>, startEquity = 10_000): TradeStats {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnlUsd > 0), losses = trades.filter((t) => t.pnlUsd <= 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  const r = trades.map((t) => t.pnlPct);
  const m = mean(r);
  const sd = n > 1 && m !== null ? Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : null;
  const gw = wins.reduce((s, t) => s + t.pnlUsd, 0), gl = -losses.reduce((s, t) => s + t.pnlUsd, 0);
  let eq = startEquity, peak = startEquity, dd = 0;
  for (const t of trades) { eq += t.pnlUsd; peak = Math.max(peak, eq); dd = Math.max(dd, peak > 0 ? ((peak - eq) / peak) * 100 : 0); }
  return {
    n, hitRate: n ? wins.length / n : null, avgWinPct: mean(wins.map((t) => t.pnlPct)), avgLossPct: mean(losses.map((t) => t.pnlPct)),
    expectancyPct: m, profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : null, sharpePerTrade: sd && sd > 0 && m !== null ? m / sd : null,
    totalPnlUsd: eq - startEquity, maxDrawdownPct: dd,
  };
}

export interface Bucket { lo: number; hi: number; n: number; winRate: number | null; meanRetPct: number | null; wilsonLo: number | null; wilsonHi: number | null }
/** Wilson score interval for a binomial proportion (95%). */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null;
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - w) / d, (c + w) / d];
}
/** Reliability table: realized win rate and mean net return by score bucket. */
export function reliability(rows: Array<{ score: number; retPct: number }>, edges: number[]): Bucket[] {
  const out: Bucket[] = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const lo = edges[k], hi = edges[k + 1];
    const xs = rows.filter((r) => r.score >= lo && (k === edges.length - 2 ? r.score <= hi : r.score < hi));
    const wins = xs.filter((r) => r.retPct > 0).length;
    const w = wilson(wins, xs.length);
    out.push({ lo, hi, n: xs.length, winRate: xs.length ? wins / xs.length : null, meanRetPct: xs.length ? xs.reduce((s, r) => s + r.retPct, 0) / xs.length : null, wilsonLo: w?.[0] ?? null, wilsonHi: w?.[1] ?? null });
  }
  return out;
}

/** Pool-adjacent-violators isotonic regression (non-decreasing) of y on x. Returns breakpoints [x, yhat]. */
export function isotonic(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number; n: number }> {
  const s = [...points].sort((a, b) => a.x - b.x);
  const blocks: Array<{ x: number; sum: number; n: number }> = [];
  for (const p of s) {
    blocks.push({ x: p.x, sum: p.y, n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].n > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].n) {
      const b2 = blocks.pop()!, b1 = blocks.pop()!;
      blocks.push({ x: b2.x, sum: b1.sum + b2.sum, n: b1.n + b2.n });
    }
  }
  return blocks.map((b) => ({ x: b.x, y: b.sum / b.n, n: b.n }));
}
export function brier(rows: Array<{ p: number; won: boolean }>): number | null {
  return rows.length ? rows.reduce((s, r) => s + (r.p - (r.won ? 1 : 0)) ** 2, 0) / rows.length : null;
}
