/**
 * Lean path-timing replay of PUMP_AGE_FILTER on saved 5m OHLCV
 * (/workspace/cletus-analysis/patterns/ohlcv) vs current rules (min age 6h, no late block).
 * Mechanical $6 clips, adaptive-style exits (no lookahead on the anchor). Honest, small-n.
 *
 *   npx tsx scripts/backtest/pump-age.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeExitPlan, planOverrides } from '../../src/lib/adaptive-exits';
import { evaluatePumpAge, findPumpAnchor, pumpAgeFromEnv, applyImpulseExitBias, type PumpAgeConfig } from '../../src/lib/pump-age';
import { simulateTrade, tradeStats, type Bar, type PoolMeta, type CostModel } from '../../src/lib/backtest/replay';

const DIR = process.env.PUMP_AGE_OHLCV ?? '/workspace/cletus-analysis/patterns/ohlcv';
const POOLS = '/workspace/cletus-analysis/patterns/selected_pools.json';
const TODAY = '/workspace/cletus-analysis/patterns/today_trades.json';
const SKIP = new Set(['TRUMP', 'PUMP', 'ZEC', 'HYPE', 'CARDS', 'USELESS', 'MPLX', 'ANSEM', 'NVDAx', 'STONK', 'mihao', 'SPCX', 'CATE']);
const SIZE = 6;
const STEP = 6; // every 30 min
const COST: CostModel = { feeBps: 50, slippageBps: 20, stopSlippageBps: 15, networkUsdPerSide: 0.02 };
const cfg: PumpAgeConfig = pumpAgeFromEnv({ PUMP_AGE_FILTER: 'on' })!;

type Pool = { pool: string; symbol: string; mint?: string; created?: string; reserve?: number; price_usd?: number; fdv?: number };
const pools: Pool[] = JSON.parse(fs.readFileSync(POOLS, 'utf8'));
const byPool = new Map(pools.map((p) => [p.pool.slice(0, 8), p]));

function loadBars(file: string): Bar[] {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
  return rows.filter((r) => r.c > 0).map((r) => ({ t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
}

function volPc(bars: Bar[], i: number) {
  const px = (ago: number) => { const j = Math.max(0, i - ago); return bars[j]!.c; };
  const c = bars[i]!.c;
  const ch = (ago: number) => c > 0 && px(ago) > 0 ? ((c / px(ago)) - 1) * 100 : 0;
  return { m5: ch(1), h1: ch(12), h6: ch(72), h24: ch(288) };
}

interface Rec { symbol: string; hours: number | null; bucket: string; baseline: boolean; filtered: boolean; pnlUsd: number; pnlPct: number; reason: string }

function decide(bars: Bar[], i: number, createdSec: number | null, price: number, nowMs: number) {
  const window = bars.slice(0, i + 1).map((b) => ({ time: b.t, open: b.o, close: b.c, volume: b.v }));
  const anchor = findPumpAnchor(window, { poolCreatedAtSec: createdSec, volFloor: cfg.volFloor });
  const ev = evaluatePumpAge({ nowMs, price, pairCreatedAtMs: createdSec != null ? createdSec * 1000 : null, anchor, cfg });
  const listingHours = createdSec != null ? (nowMs / 1000 - createdSec) / 3600 : ev.hoursSincePump;
  const baseline = listingHours != null && listingHours >= 6; // current MIN_TOKEN_AGE_HOURS=6
  const filtered = !ev.block && !ev.downWeight; // conservative: treat down-weight as skip
  const bucket = ev.block ? 'late_below' : ev.downWeight ? 'late_unknown' : ev.inImpulse ? 'impulse' : ev.isLate ? 'late_above' : 'mid';
  return { ev, baseline, filtered, bucket };
}

function runPool(file: string, p: Pool): Rec[] {
  const bars = loadBars(file);
  if (bars.length < 24) return [];
  const createdSec = p.created ? Date.parse(p.created) / 1000 : null;
  const meta: PoolMeta = { pool: p.pool, mint: p.mint ?? p.pool, symbol: p.symbol, dex: 'x', supply: 1e9, createdAtMs: createdSec != null ? createdSec * 1000 : null, liqNow: p.reserve ?? 50_000, priceNow: p.price_usd ?? bars[bars.length - 1]!.c };
  const end = bars[bars.length - 1]!.t + 300;
  const out: Rec[] = [];
  for (let i = 12; i < bars.length - 24; i += STEP) {
    const nowMs = (bars[i]!.t + 300) * 1000;
    const d = decide(bars, i, createdSec, bars[i]!.c, nowMs);
    if (!d.baseline && !d.filtered) continue;
    let plan = computeExitPlan({ composite: 0.65, liquidityUsd: meta.liqNow, priceChange: volPc(bars, i) });
    if (d.filtered && d.ev.inImpulse) plan = applyImpulseExitBias(plan, d.ev.hoursSincePump, cfg);
    const ov = planOverrides(plan);
    const tr = simulateTrade(bars, i, meta, { ...ov, holdTimeMinutes: 10080 }, ov.tpLadder, COST, SIZE, end);
    if (!tr || tr.censored) continue;
    out.push({ symbol: p.symbol, hours: d.ev.hoursSincePump, bucket: d.bucket, baseline: d.baseline, filtered: d.filtered, pnlUsd: tr.pnlUsd, pnlPct: tr.pnlPct, reason: tr.reason });
  }
  return out;
}

function summarize(rows: Rec[], pred: (r: Rec) => boolean) {
  const xs = rows.filter(pred);
  const s = tradeStats(xs.map((r) => ({ pnlPct: r.pnlPct, pnlUsd: r.pnlUsd })), 10_000);
  return { n: xs.length, wins: xs.filter((r) => r.pnlUsd > 0).length, winRate: s.hitRate, meanPct: s.expectancyPct, totalUsd: s.totalPnlUsd };
}

function main() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('_5m.json'));
  const all: Rec[] = [];
  for (const f of files) {
    const prefix = f.split('_')[1]?.slice(0, 8) ?? '';
    const symbol = f.split('_')[0]!;
    if (SKIP.has(symbol)) continue;
    const p = byPool.get(prefix) ?? { pool: prefix, symbol, reserve: 50_000 };
    if ((p.fdv ?? 0) > 20_000_000) continue;
    all.push(...runPool(path.join(DIR, f), { ...p, symbol: p.symbol || symbol }));
  }
  const base = summarize(all, (r) => r.baseline);
  const filt = summarize(all, (r) => r.filtered);
  const byB = (b: string) => summarize(all, (r) => r.bucket === b);
  let today: Array<{ tag: string; hours: number | null; vsAnchor: number | null; block: boolean; downWeight: boolean; inImpulse: boolean; logged_pnl_pct?: number }> = [];
  try {
    const trades = JSON.parse(fs.readFileSync(TODAY, 'utf8')) as Array<{ tag: string; entry_ts: string; entry_price_logged: number; logged_pnl_pct: number }>;
    for (const t of trades) {
      const p = pools.find((x) => x.symbol === t.tag);
      if (!p) continue;
      const file = files.find((f) => f.startsWith(t.tag + '_') && f.endsWith('_5m.json'));
      if (!file) continue;
      const bars = loadBars(path.join(DIR, file));
      const nowMs = Date.parse(t.entry_ts);
      const i = bars.findIndex((b) => b.t * 1000 > nowMs) - 1;
      const idx = i >= 0 ? i : bars.length - 1;
      const createdSec = p.created ? Date.parse(p.created) / 1000 : null;
      const d = decide(bars, Math.max(0, idx), createdSec, t.entry_price_logged, nowMs);
      today.push({ tag: t.tag, hours: d.ev.hoursSincePump, vsAnchor: d.ev.vsAnchor, block: d.ev.block, downWeight: d.ev.downWeight, inImpulse: d.ev.inImpulse, logged_pnl_pct: t.logged_pnl_pct });
    }
  } catch { /* optional */ }
  const harmful = filt.n >= 20 && ((base.meanPct != null && filt.meanPct != null && filt.meanPct < base.meanPct - 2) || filt.totalUsd < base.totalUsd - 5);
  const out = { baseline: base, filtered: filt, buckets: { impulse: byB('impulse'), mid: byB('mid'), late_below: byB('late_below'), late_unknown: byB('late_unknown'), late_above: byB('late_above') }, today, harmful, note: 'Equal-weighted $6 mechanical entries every 30m on saved 5m OHLCV; baseline = current min-age 6h; filtered = waive 6h, block late+below, skip late-unknown (down-weight). Small n, not a proven edge.' };
  const dest = '/workspace/cletus-analysis/patterns/pump_age_backtest.json';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main();
