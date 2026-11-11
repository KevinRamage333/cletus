/**
 * VOLUME-FADE exit replay (on top of the live adaptive+learning exits). Derived from adaptive-exits.ts.
 * Grid over fade thresholds; fade checked at each 5m bar close vs the entry baseline (mean 5m volume of the
 * 12 bars before entry). Buy share is a close-location proxy (no real buy/sell split in OHLCV): weak.
 *   npx tsx --env-file=.env.local scripts/backtest/volume-fade.ts
 *
 * (original header) Out-of-sample comparison of LIVE owner exit styles on the same entries (liquidity weight set, $70k-$5M,
 * 1 open position, $6 clip): old fixed 5/20, the fixed taper (SL 20, 50%@+50, BE, 8% trail, +150, stale 120m ±3%),
 * and self-directed adaptive plans (src/lib/adaptive-exits.ts) with and without the learning loop.
 * Same replay primitives as run.ts / weightset.ts (no lookahead, fees + AMM impact + slippage). Read-only.
 *
 *   npx tsx --env-file=.env.local scripts/backtest/adaptive-exits.ts [--size 6] [--train 0.6] [--thr 0.5,0.55,0.6,0.65]
 */
import pg from 'pg';
import { buildConfig, applyOwnerPlan, SIGNAL_NAMES, type SignalName } from '../../src/lib/config';
import { rankCandidates } from '../../src/lib/signals';
import { expectedFeeBps } from '../../src/lib/jupiter';
import type { ExitParams, TpRung } from '../../src/lib/exits';
import { computeExitPlan, planOverrides, planWithinBounds, regimeStats, type PastTrade, type PriceChange, type RegimeStats } from '../../src/lib/adaptive-exits';
import { snapshotAt, simulateTrade, volumePrefix, BAR_SEC, type Bar, type PoolMeta, type TradeResult, type BarExitHook } from '../../src/lib/backtest/replay';
import { boundedFade, fadeReason, stepFade, type FadeParams, type FadeState } from '../../src/lib/volume-fade';

const argv = process.argv;
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i > 0 ? argv[i + 1] : d; };
const SIZE = Number(arg('size', '6'));
const TRAIN = Number(arg('train', '0.6'));
const THRS = arg('thr', '0.6').split(',').map(Number);
const pgc = (url: string) => { const u = new URL(url); u.searchParams.delete('sslmode'); u.searchParams.delete('schema'); return new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } }); };

type Style = 'fixed_5_20' | 'taper_fixed' | 'adaptive' | 'adaptive_learn';
interface Row { p: number; i: number; t: number; s: number; fee: number; pc: PriceChange; liq: number | null; h1: number }

async function main() {
  const md = pgc(process.env.MARKET_DATA_DATABASE_URL!); await md.connect();
  const pools = (await md.query(`select p.address, p.base_mint, p.base_symbol, p.dex, s.price_usd, s.fdv_usd, s.mcap_usd, s.reserve_usd, s.pool_created_at
    from market_data.pools p join lateral (select * from market_data.pool_snapshots s where s.pool = p.address order by taken_at desc limit 1) s on true`)).rows;
  const bars = (await md.query(`select pool, extract(epoch from bucket)::bigint as t, open, high, low, close, volume_usd from market_data.ohlcv_5m order by pool, bucket`)).rows;
  await md.end();
  let liveW: Record<SignalName, number> | null = null;
  try {
    const app = pgc(process.env.DATABASE_URL!); await app.connect(); await app.query('set search_path=app');
    const w = (await app.query(`select name, weight from "SignalWeight"`)).rows;
    if (w.length === SIGNAL_NAMES.length) liveW = Object.fromEntries(w.map((r) => [r.name, Number(r.weight)])) as Record<SignalName, number>;
    await app.end();
  } catch { /* optional */ }
  const byPool = new Map<string, Bar[]>();
  for (const r of bars) { const a = byPool.get(r.pool) ?? []; a.push({ t: Number(r.t), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume_usd) }); byPool.set(r.pool, a); }
  const metas: PoolMeta[] = []; const series: Bar[][] = [];
  for (const p of pools) {
    const b = byPool.get(p.address); const price = Number(p.price_usd); const fdv = Number(p.fdv_usd ?? p.mcap_usd);
    if (!b || b.length < 100 || !(price > 0) || !(fdv > 0)) continue;
    metas.push({ pool: p.address, mint: p.base_mint, symbol: p.base_symbol ?? '?', dex: p.dex, supply: fdv / price, createdAtMs: p.pool_created_at ? new Date(p.pool_created_at).getTime() : null, liqNow: p.reserve_usd ? Number(p.reserve_usd) : null, priceNow: price });
    series.push(b);
  }
  const end = Math.max(...series.map((s) => s[s.length - 1].t + BAR_SEC));
  const base = { ...process.env, TRADING_MODE: 'simulation', MCAP_PRESET: 'BALANCED', MIN_MARKET_CAP: '70000', MAX_MARKET_CAP: '5000000', OWNER_PLAN_ENABLED: 'true', SIGNAL_WEIGHT_SET: 'liquidity', ENABLE_TRAILING_STOP: 'false', HOLD_TIME_MINUTES: '10080', STALE_POSITION_MINUTES: '0' };
  const cfg = applyOwnerPlan(buildConfig(base), true);
  const w = liveW ?? cfg.initialWeights;
  const netUsd = ((5000 + cfg.priorityFeeLamports) / 1e9) * cfg.solPriceFallbackUsd;
  const cost = (fee: number) => ({ feeBps: fee, slippageBps: 30, stopSlippageBps: 100, networkUsdPerSide: netUsd });

  const rows: Row[] = [];
  const h1ByT = new Map<number, number[]>();
  for (let p = 0; p < series.length; p++) {
    const pre = volumePrefix(series[p]);
    for (let i = 0; i < series[p].length; i++) {
      const snap = snapshotAt(series[p], i, metas[p], pre); if (!snap) continue;
      const t = series[p][i].t + BAR_SEC;
      const c = rankCandidates([snap], cfg, w, t * 1000)[0];
      if (c.rejected) continue;
      const h1 = snap.priceChange?.h1 ?? 0;
      rows.push({ p, i, t, s: c.composite, fee: expectedFeeBps(c.ageHours, process.env, { chargeOperatorFee: false }), pc: snap.priceChange ?? {}, liq: c.liquidityUsd, h1 });
      const a = h1ByT.get(t) ?? []; a.push(h1); h1ByT.set(t, a);
    }
  }
  const regimeAt = (t: number): RegimeStats => regimeStats(h1ByT.get(t) ?? [], t * 1000);
  const ts = rows.map((r) => r.t).sort((a, b) => a - b); const split = ts[0] + TRAIN * (ts[ts.length - 1] - ts[0]);
  const days = (from: number, to: number) => Math.max(1e-9, (to - from) / 86400);
  const fixed = (o: Partial<ExitParams>): ExitParams => ({ stopLossPct: 5, takeProfitPct: 20, breakEvenTriggerPct: 1e9, enableTrailingStop: false, trailingStopPct: 8, holdTimeMinutes: 10080, stalePositionMinutes: 0, staleBandPct: 3, ...o });
  const TAPER = fixed({ stopLossPct: 20, takeProfitPct: 150, breakEvenTriggerPct: 50, enableTrailingStop: true, trailingStopPct: 8, trailingArmPct: 50, stalePositionMinutes: 120, staleBandPct: 3 });
  const TAPER_LADDER: TpRung[] = [{ gainPct: 50, sellPct: 50 }];

  const excursions = (bs: Bar[], i: number, k: number) => {
    const e = bs[i].c; let hi = e, lo = e;
    for (let j = i + 1; j <= k && j < bs.length; j++) { hi = Math.max(hi, bs[j].h); lo = Math.min(lo, bs[j].l); }
    return { mfePct: (hi / e - 1) * 100, maePct: (1 - lo / e) * 100 };
  };

  const hookFor = (bs: Bar[], i: number, fp: FadeParams | null): BarExitHook | undefined => {
    if (!fp) return undefined;
    let base = 0, nb = 0; for (let j = Math.max(0, i - 11); j <= i; j++) { base += bs[j].v; nb++; } base /= Math.max(1, nb);
    let st: FadeState = { since: null, reason: null };
    return (k, ctx) => {
      const b = bs[k]; const range = b.h - b.l; const share = range > 0 ? (b.c - b.l) / range : 0.5;
      const why = fadeReason({ m5VolUsd: b.v, buys: Math.round(share * 10), sells: 10 - Math.round(share * 10) }, base, fp);
      if (why && st.since === null) st = { since: b.t * 1000, reason: why };
      const r = stepFade(st, why, (b.t + BAR_SEC) * 1000, { openedAt: ctx.openedAtSec * 1000, gainPct: (ctx.close / ctx.entry - 1) * 100 }, fp);
      st = r.st;
      return r.fire && ctx.taken === 0 ? 'volume_fade' : null;
    };
  };
  const run = (style: Style, thr: number, from: number, to: number, seed: PastTrade[] = [], fp: FadeParams | null = null) => {
    const cands = rows.filter((r) => r.t >= from && r.t < to && r.s >= thr).sort((a, b) => a.t - b.t || b.s - a.s);
    let busyUntil = 0; const tr: Array<TradeResult & { sl: number }> = []; const hist = [...seed]; let outOfBounds = 0;
    for (const r of cands) {
      if (r.t < busyUntil) continue;
      let e: ExitParams, ladder: TpRung[] = [];
      if (style === 'fixed_5_20') e = fixed({});
      else if (style === 'taper_fixed') { e = TAPER; ladder = TAPER_LADDER; }
      else {
        const plan = computeExitPlan({ priceChange: r.pc, composite: r.s, liquidityUsd: r.liq, regime: regimeAt(r.t), history: style === 'adaptive_learn' ? hist : [] });
        if (!planWithinBounds(plan)) outOfBounds++;
        const o = planOverrides(plan);
        e = fixed({ ...o }); ladder = o.tpLadder;
      }
      const o = simulateTrade(series[r.p], r.i, metas[r.p], e, ladder, cost(r.fee), SIZE, end, hookFor(series[r.p], r.i, fp));
      if (!o || o.censored || o.exitTime > to) continue;
      busyUntil = o.exitTime; tr.push({ ...o, sl: e.stopLossPct });
      const x = excursions(series[r.p], r.i, o.exitIdx);
      hist.push({ ...x, pnlPct: o.pnlPct, stopLossPct: e.stopLossPct, won: o.pnlUsd > 0 });
    }
    const n = tr.length; const hit = n ? tr.filter((x) => x.pnlUsd > 0).length / n : 0; const exp = n ? tr.reduce((s, x) => s + x.pnlPct, 0) / n : 0;
    const usd = tr.reduce((s, x) => s + x.pnlUsd, 0);
    const worst = n ? Math.min(...tr.map((x) => x.pnlPct)) : 0;
    const reasons: Record<string, number> = {}; for (const x of tr) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
    const avgSl = n ? tr.reduce((s, x) => s + x.sl, 0) / n : 0;
    return { n, hit, exp, usd, worst, perDay: n / days(from, Math.min(to, end)), reasons, avgSl, outOfBounds, hist };
  };
  console.log(`${rows.length} eligible decisions over ${(days(ts[0], ts[ts.length - 1])).toFixed(1)} days, ${series.length} pools; split at ${new Date(split * 1000).toISOString()}`);
  const holdMin = (tr: number, n: number) => (n ? tr / n : 0);
  void holdMin;
  const grid: Array<FadeParams | null> = [null];
  for (const volFrac of [0.1, 0.2, 0.3]) for (const minutes of [15, 20, 30]) for (const maxBuyShare of [0.2, 0.35]) grid.push(boundedFade({ volFrac, minutes, maxBuyShare, maxGainPct: 15 }));
  console.log('fade (volFrac/min/buyShare) | thr | TRAIN n exp% $ | TEST n hit exp% $total worst% trades/day | fades train/test');
  for (const thr of THRS) {
    for (const fp of grid) {
      const a = run('adaptive_learn', thr, ts[0], split, [], fp);
      const b = run('adaptive_learn', thr, split, Infinity, a.hist, fp);
      const tag = fp ? `${fp.volFrac}/${fp.minutes}/${fp.maxBuyShare}` : 'none';
      console.log(`${tag.padEnd(14)} ${thr.toFixed(2)} | ${a.n} ${a.exp.toFixed(2)} ${a.usd.toFixed(2)} | ${b.n} ${(b.hit * 100).toFixed(0)}% ${b.exp.toFixed(2)} ${b.usd >= 0 ? '+' : ''}${b.usd.toFixed(2)} ${b.worst.toFixed(1)} ${b.perDay.toFixed(1)} | ${a.reasons.volume_fade ?? 0}/${b.reasons.volume_fade ?? 0} | ${Object.entries(b.reasons).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
