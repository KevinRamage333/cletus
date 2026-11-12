/**
 * Live entry gate: 10-minute buy-side USD volume must clear min($MIN_BUY_VOLUME_10M_USD, MIN_BUY_VOLUME_10M_MCAP_PCT% of mcap).
 * Defaults: $10,000 or 5% of market cap, whichever is lower.
 *
 * Volume source: last two 5m candle volumes when provided (Gecko/OHLCV); otherwise DexScreener
 * m5 total volume × 2. Buy-side is that total times the buy share of m5 txns (DexScreener does
 * not publish buy-only USD, only buy/sell counts). Missing txn counts → treat share as 1 (total volume).
 */
export const DEFAULT_MIN_BUY_VOL_USD = 10_000;
export const DEFAULT_MIN_BUY_VOL_MCAP_PCT = 5;

export interface BuyVolInput {
  m5VolUsd?: number | null;
  m5Buys?: number | null;
  m5Sells?: number | null;
  /** Ascending 5m candles; last two with volume are summed when present. */
  candles5m?: Array<{ volume: number }> | null;
  marketCapUsd?: number | null;
}

export interface BuyVolConfig {
  minUsd: number;
  mcapPct: number;
}

export interface BuyVolEstimate {
  buyVol10mUsd: number;
  totalVol10mUsd: number;
  buyShare: number | null;
  source: 'candles5m_x2_tx_share' | 'dex_m5_x2_tx_share' | 'candles5m_x2_total' | 'dex_m5_x2_total';
  thresholdUsd: number;
  pass: boolean;
  reason: string | null;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function buyVolumeGateConfig(env: Record<string, string | undefined> = process.env): BuyVolConfig | null {
  const raw = env.MIN_BUY_VOLUME_10M_USD;
  if (raw !== undefined && raw !== '' && Number(raw) === 0) return null;
  const minUsd = fin(Number(raw)) && raw !== undefined && raw !== '' ? Number(raw) : DEFAULT_MIN_BUY_VOL_USD;
  const pctRaw = env.MIN_BUY_VOLUME_10M_MCAP_PCT;
  const mcapPct = fin(Number(pctRaw)) && pctRaw !== undefined && pctRaw !== '' ? Number(pctRaw) : DEFAULT_MIN_BUY_VOL_MCAP_PCT;
  if (!(minUsd > 0)) return null;
  return { minUsd, mcapPct: Math.max(0, mcapPct) };
}

/** Threshold = min($minUsd, mcapPct% of mcap). Missing/zero mcap → $minUsd alone. */
export function buyVolumeThresholdUsd(mcapUsd: number | null | undefined, cfg: BuyVolConfig): number {
  if (cfg.mcapPct > 0 && fin(mcapUsd) && mcapUsd > 0) {
    return Math.min(cfg.minUsd, (cfg.mcapPct / 100) * mcapUsd);
  }
  return cfg.minUsd;
}

export function estimateBuyVolume10m(inp: BuyVolInput, cfg: BuyVolConfig): BuyVolEstimate {
  const lastTwo = (inp.candles5m ?? []).filter((c) => fin(c.volume)).slice(-2);
  const fromCandles = lastTwo.length === 2 ? lastTwo[0]!.volume + lastTwo[1]!.volume : null;
  const fromM5 = fin(inp.m5VolUsd) ? inp.m5VolUsd * 2 : null;
  const total = fromCandles != null ? fromCandles : (fromM5 ?? 0);
  const buys = inp.m5Buys ?? 0;
  const sells = inp.m5Sells ?? 0;
  const n = buys + sells;
  const share = n > 0 ? buys / n : null;
  const buyVol = share != null ? total * share : total;
  const usedCandles = fromCandles != null;
  const source = usedCandles
    ? (share != null ? 'candles5m_x2_tx_share' : 'candles5m_x2_total')
    : (share != null ? 'dex_m5_x2_tx_share' : 'dex_m5_x2_total');
  const thresholdUsd = buyVolumeThresholdUsd(inp.marketCapUsd, cfg);
  const pass = buyVol + 1e-9 >= thresholdUsd;
  const usd = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;
  const reason = pass ? null : `buy vol 10m ${usd(buyVol)} < ${usd(thresholdUsd)}`;
  return { buyVol10mUsd: buyVol, totalVol10mUsd: total, buyShare: share, source, thresholdUsd, pass, reason };
}
