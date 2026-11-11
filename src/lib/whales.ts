/**
 * Whale & smart-money tracking ("big money movers") from Helius Parsed Events — never scraped from solscan.com.
 * Solscan is only linked for display (and its Pro API is used only if SOLSCAN_API_KEY is set; not required).
 *
 * Pure parts (unit-tested): swap extraction from parsed transactions, per-token flow features, smart-money discovery
 * from realized PnL, fresh-wallet bundle clusters, the confirm/veto gate and the fast-exit decision.
 * I/O parts: budgeted collector (Helius credits), market_data storage, in-memory cache for the engine and the Brain.
 */
export const WSOL = 'So11111111111111111111111111111111111111112';
const STABLES = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);

export interface ParsedTx {
  signature: string; parserStatus?: string;
  parsed?: { blockTime?: number; slot?: number; feePayer?: string; transactionStatus?: string; error?: unknown;
    nativeTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; amount?: number }>;
    tokenTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; rawTokenAmount?: number | string; decimals?: number; mint?: string }>;
    summary?: { type?: string } | null };
}
export interface WhaleSwap { signature: string; mint: string; pool: string; wallet: string; side: 'buy' | 'sell'; tokenAmount: number; solAmount: number; usd: number; blockTime: number; slot: number | null }

/** Extract the fee payer's swap of `mint` from a parsed transaction (net token delta; SOL leg = wSOL delta, else stables). */
export function swapFromParsed(tx: ParsedTx, mint: string, pool: string, priceUsd: number, solUsd: number): WhaleSwap | null {
  const p = tx.parsed; if (!p || tx.parserStatus && tx.parserStatus !== 'OK' || p.error || (p.transactionStatus && p.transactionStatus !== 'OK')) return null;
  const w = p.feePayer; if (!w) return null;
  let tok = 0, sol = 0, stable = 0;
  for (const t of p.tokenTransfers ?? []) {
    const amt = Number(t.rawTokenAmount ?? 0) / 10 ** (t.decimals ?? 0);
    const d = (t.toUserAccount === w ? amt : 0) - (t.fromUserAccount === w ? amt : 0);
    if (t.mint === mint) tok += d; else if (t.mint === WSOL) sol += d; else if (t.mint && STABLES.has(t.mint)) stable += d;
  }
  if (Math.abs(tok) <= 0) return null;
  const side = tok > 0 ? 'buy' : 'sell';
  const usd = Math.abs(sol) > 0 && solUsd > 0 ? Math.abs(sol) * solUsd : Math.abs(stable) > 0 ? Math.abs(stable) : Math.abs(tok) * priceUsd;
  return { signature: tx.signature, mint, pool, wallet: w, side, tokenAmount: Math.abs(tok), solAmount: Math.abs(sol), usd, blockTime: p.blockTime ?? 0, slot: p.slot ?? null };
}

export type WalletKind = 'smart' | 'dev' | 'top_holder' | 'insider' | 'manual';
export interface WatchedWallet { address: string; kind: WalletKind; mint: string; label?: string | null; score?: number | null }

export interface FlowFeatures {
  mint: string; windowMin: number; swaps: number; buyUsd: number; sellUsd: number; flowRatio: number | null;
  whaleThresholdUsd: number; whaleBuyUsd: number; whaleSellUsd: number; whaleNetUsd: number; whaleBuyers: number; whaleSellers: number;
  smartBuyUsd: number; smartSellUsd: number; smartBuyers: string[]; smartSellers: string[];
  devKnown: boolean; devSoldUsd: number; devSells: number; devSoldPctOfBought: number | null; insiderSellUsd: number;
  freshCluster: { buyers: number; totalUsd: number; sizeCv: number; windowSec: number } | null;
  topHolderChangePct: number | null;
}

/** Whale threshold: max($1k, 0.5% of pool liquidity) unless overridden. */
export const whaleThreshold = (liquidityUsd: number | null | undefined, minUsd = Number(process.env.WHALE_MIN_USD ?? 1000)) => Math.max(minUsd, (liquidityUsd ?? 0) * 0.005);

/** Fresh-wallet buy cluster (bundling / sybil): ≥ minBuyers distinct NEW wallets buying similar sizes within windowSec. */
export function freshBuyCluster(swaps: WhaleSwap[], freshWallets: Set<string>, windowSec = 120, minBuyers = 4) {
  const buys = swaps.filter((s) => s.side === 'buy' && freshWallets.has(s.wallet)).sort((a, b) => a.blockTime - b.blockTime);
  let best: FlowFeatures['freshCluster'] = null;
  for (let i = 0; i < buys.length; i++) {
    const win = buys.filter((b) => b.blockTime >= buys[i].blockTime && b.blockTime <= buys[i].blockTime + windowSec);
    const byW = new Map<string, number>(); for (const b of win) byW.set(b.wallet, (byW.get(b.wallet) ?? 0) + b.usd);
    if (byW.size < minBuyers) continue;
    const v = [...byW.values()]; const m = v.reduce((a, b) => a + b, 0) / v.length; const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    const c = { buyers: byW.size, totalUsd: v.reduce((a, b) => a + b, 0), sizeCv: m > 0 ? sd / m : 0, windowSec };
    if (!best || c.buyers > best.buyers) best = c;
  }
  return best;
}

export function flowFeatures(mint: string, swaps: WhaleSwap[], watched: WatchedWallet[], o: { nowSec: number; windowMin?: number; liquidityUsd?: number | null; freshWallets?: Set<string>; topHolderChangePct?: number | null }): FlowFeatures {
  const windowMin = o.windowMin ?? 30;
  const xs = swaps.filter((s) => s.mint === mint && s.blockTime <= o.nowSec && s.blockTime > o.nowSec - windowMin * 60); // past only
  const thr = whaleThreshold(o.liquidityUsd);
  const kinds = new Map<string, Set<WalletKind>>();
  for (const w of watched) if (!w.mint || w.mint === mint || w.kind === 'smart' || w.kind === 'manual') { const k = kinds.get(w.address) ?? new Set(); k.add(w.kind); kinds.set(w.address, k); }
  const is = (a: string, k: WalletKind) => kinds.get(a)?.has(k) ?? false;
  const sum = (f: (s: WhaleSwap) => boolean) => xs.filter(f).reduce((a, s) => a + s.usd, 0);
  const buyUsd = sum((s) => s.side === 'buy'), sellUsd = sum((s) => s.side === 'sell');
  const whales = xs.filter((s) => s.usd >= thr);
  const smart = xs.filter((s) => is(s.wallet, 'smart') || is(s.wallet, 'manual'));
  const dev = xs.filter((s) => is(s.wallet, 'dev'));
  const devAll = swaps.filter((s) => s.mint === mint && is(s.wallet, 'dev') && s.blockTime <= o.nowSec);
  const devBought = devAll.filter((s) => s.side === 'buy').reduce((a, s) => a + s.tokenAmount, 0);
  const devSoldTok = dev.filter((s) => s.side === 'sell').reduce((a, s) => a + s.tokenAmount, 0);
  return {
    mint, windowMin, swaps: xs.length, buyUsd, sellUsd, flowRatio: buyUsd + sellUsd > 0 ? buyUsd / (buyUsd + sellUsd) : null,
    whaleThresholdUsd: thr, whaleBuyUsd: whales.filter((s) => s.side === 'buy').reduce((a, s) => a + s.usd, 0), whaleSellUsd: whales.filter((s) => s.side === 'sell').reduce((a, s) => a + s.usd, 0),
    whaleNetUsd: whales.reduce((a, s) => a + (s.side === 'buy' ? s.usd : -s.usd), 0),
    whaleBuyers: new Set(whales.filter((s) => s.side === 'buy').map((s) => s.wallet)).size, whaleSellers: new Set(whales.filter((s) => s.side === 'sell').map((s) => s.wallet)).size,
    smartBuyUsd: smart.filter((s) => s.side === 'buy').reduce((a, s) => a + s.usd, 0), smartSellUsd: smart.filter((s) => s.side === 'sell').reduce((a, s) => a + s.usd, 0),
    smartBuyers: [...new Set(smart.filter((s) => s.side === 'buy').map((s) => s.wallet))], smartSellers: [...new Set(smart.filter((s) => s.side === 'sell').map((s) => s.wallet))],
    devKnown: watched.some((w) => w.kind === 'dev' && (w.mint === mint || !w.mint)),
    devSoldUsd: dev.filter((s) => s.side === 'sell').reduce((a, s) => a + s.usd, 0), devSells: dev.filter((s) => s.side === 'sell').length,
    devSoldPctOfBought: devBought > 0 ? Math.min(1, devSoldTok / devBought) : null,
    insiderSellUsd: xs.filter((s) => s.side === 'sell' && (is(s.wallet, 'insider') || is(s.wallet, 'top_holder'))).reduce((a, s) => a + s.usd, 0),
    freshCluster: o.freshWallets ? freshBuyCluster(xs, o.freshWallets) : null,
    topHolderChangePct: o.topHolderChangePct ?? null,
  };
}

/**
 * Smart-money discovery from stored swaps: wallets with realized profit on ≥ minTokens tokens (average-cost basis),
 * that bought early (in the first `earlyFrac` of the observed history of that token). Pure.
 */
export function discoverSmartMoney(swaps: WhaleSwap[], o: { minTokens?: number; minRealizedUsd?: number; earlyFrac?: number; minWinRate?: number } = {}) {
  const minTokens = o.minTokens ?? 2, minPnl = o.minRealizedUsd ?? 1000, earlyFrac = o.earlyFrac ?? 0.3, minWin = o.minWinRate ?? 0.6;
  const span = new Map<string, [number, number]>();
  for (const s of swaps) { const r = span.get(s.mint) ?? [Infinity, -Infinity]; span.set(s.mint, [Math.min(r[0], s.blockTime), Math.max(r[1], s.blockTime)]); }
  const per = new Map<string, Map<string, { cost: number; qty: number; realized: number; early: boolean; sold: boolean }>>();
  for (const s of [...swaps].sort((a, b) => a.blockTime - b.blockTime)) {
    const m = per.get(s.wallet) ?? new Map(); per.set(s.wallet, m);
    const p = m.get(s.mint) ?? { cost: 0, qty: 0, realized: 0, early: false, sold: false }; m.set(s.mint, p);
    if (s.side === 'buy') {
      const [a, b] = span.get(s.mint)!; if (b > a && s.blockTime <= a + (b - a) * earlyFrac) p.early = true;
      p.cost += s.usd; p.qty += s.tokenAmount;
    } else if (p.qty > 0) {
      const q = Math.min(p.qty, s.tokenAmount); const basis = (p.cost / p.qty) * q;
      p.realized += (s.usd * q) / s.tokenAmount - basis; p.cost -= basis; p.qty -= q; p.sold = true;
    }
  }
  const out: Array<{ address: string; tokens: number; wins: number; realizedUsd: number; score: number }> = [];
  for (const [address, m] of per) {
    const traded = [...m.values()].filter((p) => p.sold && p.early);
    if (traded.length < minTokens) continue;
    const wins = traded.filter((p) => p.realized > 0).length, realizedUsd = traded.reduce((a, p) => a + p.realized, 0);
    if (realizedUsd >= minPnl && wins / traded.length >= minWin) out.push({ address, tokens: traded.length, wins, realizedUsd, score: realizedUsd * (wins / traded.length) });
  }
  return out.sort((a, b) => b.score - a.score);
}

export type GateVerdict = { veto: boolean; confirm: boolean; reasons: string[] };
/** Confirmer / veto with order flow. Never a standalone buy trigger: `confirm` only matters for a candidate that already passed. */
export function whaleGate(f: FlowFeatures | null): GateVerdict {
  const r: string[] = []; if (!f) return { veto: false, confirm: false, reasons: ['no on-chain flow data'] };
  let veto = false, confirm = false;
  if (f.devSells > 0 && (f.devSoldPctOfBought === null || f.devSoldPctOfBought >= 0.2 || f.devSoldUsd >= f.whaleThresholdUsd)) { veto = true; r.push(`dev wallet sold $${Math.round(f.devSoldUsd)}`); }
  if (f.smartSellUsd > f.smartBuyUsd && f.smartSellers.length >= 2) { veto = true; r.push(`${f.smartSellers.length} smart-money wallets exiting`); }
  if (f.whaleNetUsd < -2 * f.whaleThresholdUsd) { veto = true; r.push(`whales net sold $${Math.round(-f.whaleNetUsd)}`); }
  if (f.freshCluster && f.freshCluster.buyers >= 5 && f.freshCluster.sizeCv < 0.25) { veto = true; r.push(`fresh-wallet bundle: ${f.freshCluster.buyers} new wallets bought similar sizes within ${f.freshCluster.windowSec}s`); }
  if (f.topHolderChangePct !== null && f.topHolderChangePct >= 5) { veto = true; r.push(`top-10 holder share rose ${f.topHolderChangePct.toFixed(1)} pts`); }
  if (!veto && f.smartBuyers.length >= 2 && (f.flowRatio ?? 0) >= 0.55) { confirm = true; r.push(`${f.smartBuyers.length} smart-money wallets bought $${Math.round(f.smartBuyUsd)} with buy-side flow`); }
  if (!veto && f.whaleNetUsd > 2 * f.whaleThresholdUsd && (f.flowRatio ?? 0) >= 0.55) { confirm = true; r.push(`whales net bought $${Math.round(f.whaleNetUsd)}`); }
  return { veto, confirm, reasons: r };
}

/** Fast exit for an OPEN position: dev dumping, or smart money / whales exiting into sell-side flow. */
export function whaleExitDecision(f: FlowFeatures | null): 'dev_exit' | 'whale_exit' | null {
  if (!f) return null;
  if (f.devSells > 0 && (f.devSoldPctOfBought === null || f.devSoldPctOfBought >= 0.2 || f.devSoldUsd >= f.whaleThresholdUsd)) return 'dev_exit';
  if ((f.smartSellers.length >= 2 && f.smartSellUsd > f.smartBuyUsd) || (f.whaleNetUsd < -3 * f.whaleThresholdUsd && (f.flowRatio ?? 1) < 0.4)) return 'whale_exit';
  return null;
}

export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}`;
export const solscanAccount = (a: string) => `https://solscan.io/account/${a}`;

/** Plain-English one-liner for the Brain. */
export function describeFlow(f: FlowFeatures, symbol?: string): string {
  const k = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`);
  const parts: string[] = [];
  if (f.smartBuyers.length) parts.push(`${f.smartBuyers.length} smart-money wallet${f.smartBuyers.length > 1 ? 's' : ''} bought ${k(f.smartBuyUsd)} in ${f.windowMin} min`);
  if (f.smartSellers.length) parts.push(`${f.smartSellers.length} smart-money wallet${f.smartSellers.length > 1 ? 's' : ''} sold ${k(f.smartSellUsd)}`);
  if (f.whaleBuyers + f.whaleSellers) parts.push(`whales (≥ ${k(f.whaleThresholdUsd)}) net ${f.whaleNetUsd >= 0 ? 'bought' : 'sold'} ${k(Math.abs(f.whaleNetUsd))}`);
  parts.push(f.devSells ? `dev wallet SOLD ${k(f.devSoldUsd)}` : f.devKnown ? "dev wallet hasn't sold in this window" : 'dev wallet not identified yet');
  if (f.freshCluster) parts.push(`${f.freshCluster.buyers} fresh wallets bought within ${f.freshCluster.windowSec}s (possible bundle)`);
  if (f.flowRatio !== null) parts.push(`buys are ${(f.flowRatio * 100).toFixed(0)}% of swap volume`);
  return `${symbol ? `${symbol}: ` : ''}${parts.join('; ')}.`;
}
