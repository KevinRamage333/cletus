/**
 * Win-rate tuning replay (walk-forward, out-of-sample) for the LIVE owner setup, $25k-$5M band.
 * Entry filters: score threshold, 10m buy-volume gate (x1/x2), min liquidity, max 1h chase, pump-age block (always on, as live).
 * Exit plans: the live adaptive+learning plan (+ impulse bias + 15-min volume fade) vs an earlier first partial
 * (+15/+20/+25% or 1R), sell 50/60%, break-even + trail armed at the partial (as live). Stops stay adaptive (8-25%).
 * Same replay primitives as volume-fade.ts (no lookahead, fees + AMM impact + slippage). Read-only; places no trades.
 *
 *   npx tsx --env-file=.env.local scripts/backtest/win-rate.ts [--folds 5] [--size 6]
 */
import pg from 'pg';
import fs from 'node:fs';
import { buildConfig, applyOwnerPlan, SIGNAL_NAMES, type SignalName } from '../../src/lib/config';
import { rankCandidates } from '../../src/lib/signals';
import { expectedFeeBps } from '../../src/lib/jupiter';
import type { ExitParams, TpRung } from '../../src/lib/exits';
import { computeExitPlan, planOverrides, planWithinBounds, regimeStats, HARD_BOUNDS, type ExitPlan, type PastTrade, type PriceChange, type RegimeStats } from '../../src/lib/adaptive-exits';
import { snapshotAt, simulateTrade, volumePrefix, BAR_SEC, type Bar, type PoolMeta, type TradeResult, type BarExitHook } from '../../src/lib/backtest/replay';
import { boundedFade, fadeReason, stepFade, type FadeParams, type FadeState } from '../../src/lib/volume-fade';
import { findPumpAnchor, evaluatePumpAge, pumpAgeFromEnv, applyImpulseExitBias } from '../../src/lib/pump-age';
import { buyVolumeThresholdUsd } from '../../src/lib/buy-volume-gate';
import { applyFirstPartial, type FirstPartial } from '../../src/lib/first-partial';

const argv = process.argv;
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i > 0 ? argv[i + 1] : d; };
const SIZE = Number(arg('size', '6'));
const FOLDS = Number(arg('folds', '5'));
const pgc = (url: string) => { const u = new URL(url); u.searchParams.delete('sslmode'); u.searchParams.delete('schema'); return new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } }); };

interface Row { p: number; i: number; t: number; s: number; fee: number; pc: PriceChange; liq: number | null; h1: number; bv: number; bvThr: number; hrs: number | null; block: boolean; bump: number }
interface Entry { thr: number; bv: number; minLiq: number; maxH1: number; lv?: number }
interface Cfg { e: Entry; x: FirstPartial | null }
const key = (c: Cfg) => `thr${c.e.thr} bv${c.e.bv} liq${c.e.minLiq / 1000}k h1<${c.e.maxH1 === Infinity ? 'inf' : c.e.maxH1} | ${c.x ? `${c.x.mode === 'r' ? `${c.x.value}R` : `+${c.x.value}%`} sell${c.x.sellPct ?? 'ad'}` : 'adaptive'}`;

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
  const base = { ...process.env, TRADING_MODE: 'simulation', MCAP_PRESET: 'BALANCED', MIN_MARKET_CAP: '25000', MAX_MARKET_CAP: '5000000', OWNER_PLAN_ENABLED: 'true', SIGNAL_WEIGHT_SET: 'liquidity', ENABLE_TRAILING_STOP: 'false', HOLD_TIME_MINUTES: '10080', STALE_POSITION_MINUTES: '0', PUMP_AGE_FILTER: 'on' };
  const cfg = applyOwnerPlan(buildConfig(base), true);
  const pa = pumpAgeFromEnv({ ...base, PUMP_AGE_LATE_HOURS: '72', PUMP_AGE_LATE_SCORE_BUMP: '0.02' })!;
  const w = liveW ?? cfg.initialWeights;
  const netUsd = ((5000 + cfg.priorityFeeLamports) / 1e9) * cfg.solPriceFallbackUsd;
  const cost = (fee: number) => ({ feeBps: fee, slippageBps: 30, stopSlippageBps: 100, networkUsdPerSide: netUsd });

  const rows: Row[] = [];
  const h1ByT = new Map<number, number[]>();
  for (let p = 0; p < series.length; p++) {
    const bs = series[p];
    const pre = volumePrefix(bs);
    const createdSec = metas[p].createdAtMs ? metas[p].createdAtMs! / 1000 : null;
    const full = findPumpAnchor(bs.map((b) => ({ time: b.t, open: b.o, close: b.c, volume: b.v })), { poolCreatedAtSec: createdSec });
    for (let i = 0; i < bs.length; i++) {
      const snap = snapshotAt(bs, i, metas[p], pre); if (!snap) continue;
      const t = bs[i].t + BAR_SEC;
      const c = rankCandidates([snap], cfg, w, t * 1000)[0];
      if (c.rejected) continue;
      const h1 = snap.priceChange?.h1 ?? 0;
      // Anchor known at time i only (a spike after i isn't visible yet).
      let anchor = full;
      if (full && full.source === 'volume_spike' && full.index > i) anchor = bs[0].t <= (createdSec ?? -Infinity) + 7200 || createdSec == null ? { index: 0, time: bs[0].t, anchorPx: bs[0].o, source: 'listing' } : { index: -1, time: createdSec, anchorPx: null, source: 'pool_created' };
      const ev = evaluatePumpAge({ nowMs: t * 1000, price: bs[i].c, pairCreatedAtMs: metas[p].createdAtMs, anchor, cfg: pa });
      const range = bs[i].h - bs[i].l; const share = range > 0 ? (bs[i].c - bs[i].l) / range : 0.5;
      const bv = (bs[i].v + (bs[i - 1]?.v ?? 0)) * share;
      const mcap = bs[i].c * metas[p].supply;
      rows.push({ p, i, t, s: c.composite, fee: expectedFeeBps(c.ageHours, process.env, { chargeOperatorFee: false }), pc: snap.priceChange ?? {}, liq: c.liquidityUsd, h1, bv, bvThr: buyVolumeThresholdUsd(mcap, { minUsd: 10_000, mcapPct: 5 }), hrs: ev.hoursSincePump, block: ev.block, bump: ev.scoreBump });
      const a = h1ByT.get(t) ?? []; a.push(h1); h1ByT.set(t, a);
    }
  }
  const regimeAt = (t: number): RegimeStats => regimeStats(h1ByT.get(t) ?? [], t * 1000);
  const ts = rows.map((r) => r.t).sort((a, b) => a - b);
  const t0 = ts[0], t1 = ts[ts.length - 1];
  const fixed = (o: Partial<ExitParams>): ExitParams => ({ stopLossPct: 5, takeProfitPct: 20, breakEvenTriggerPct: 1e9, enableTrailingStop: false, trailingStopPct: 8, holdTimeMinutes: 10080, stalePositionMinutes: 0, staleBandPct: 3, ...o });
  const FADE: FadeParams = boundedFade({ volFrac: 0.1, minutes: 15, maxBuyShare: 0.2, maxGainPct: 15 });
  const excursions = (bs: Bar[], i: number, k: number) => {
    const e = bs[i].c; let hi = e, lo = e;
    for (let j = i + 1; j <= k && j < bs.length; j++) { hi = Math.max(hi, bs[j].h); lo = Math.min(lo, bs[j].l); }
    return { mfePct: (hi / e - 1) * 100, maePct: (1 - lo / e) * 100 };
  };
  const hookFor = (bs: Bar[], i: number, lv = 0): BarExitHook => {
    let b0 = 0, nb = 0; for (let j = Math.max(0, i - 11); j <= i; j++) { b0 += bs[j].v; nb++; } b0 /= Math.max(1, nb);
    let st: FadeState = { since: null, reason: null };
    return (k, ctx) => {
      const b = bs[k]; const range = b.h - b.l; const share = range > 0 ? (b.c - b.l) / range : 0.5;
      const why = fadeReason({ m5VolUsd: b.v, buys: Math.round(share * 10), sells: 10 - Math.round(share * 10) }, b0, FADE);
      if (why && st.since === null) st = { since: b.t * 1000, reason: why };
      const r = stepFade(st, why, (b.t + BAR_SEC) * 1000, { openedAt: ctx.openedAtSec * 1000, gainPct: (ctx.close / ctx.entry - 1) * 100 }, FADE);
      st = r.st;
      if (lv > 0 && k > i + 1 && b.v < lv) return 'low_volume_5m'; // owner rule: 5m volume < floor after the first candle
      return r.fire && ctx.taken === 0 ? 'volume_fade' : null;
    };
  };
  const pass = (r: Row, e: Entry) => r.s >= e.thr + r.bump && !r.block && (e.bv === 0 || r.bv >= e.bv * r.bvThr) && (r.liq ?? 0) >= e.minLiq && r.h1 <= e.maxH1 && (!e.lv || series[r.p][r.i].v >= e.lv);
  type Tr = TradeResult & { sl: number };
  const run = (c: Cfg, from: number, to: number) => {
    const cands = rows.filter((r) => r.t >= from && r.t < to && pass(r, c.e)).sort((a, b) => a.t - b.t || b.s - a.s);
    let busyUntil = 0; const tr: Tr[] = []; const hist: PastTrade[] = []; let oob = 0;
    for (const r of cands) {
      if (r.t < busyUntil) continue;
      let plan: ExitPlan = computeExitPlan({ priceChange: r.pc, composite: r.s, liquidityUsd: r.liq, regime: regimeAt(r.t), history: hist });
      plan = applyImpulseExitBias(plan, r.hrs, pa);
      if (c.x) plan = applyFirstPartial(plan, c.x);
      if (!planWithinBounds(plan)) { oob++; continue; }
      const o = planOverrides(plan);
      const e = fixed({ ...o });
      const res = simulateTrade(series[r.p], r.i, metas[r.p], e, o.tpLadder, cost(r.fee), SIZE, end, hookFor(series[r.p], r.i, c.e.lv ?? 0));
      if (!res || res.censored || res.exitTime > to) continue;
      busyUntil = res.exitTime; tr.push({ ...res, sl: e.stopLossPct });
      hist.push({ ...excursions(series[r.p], r.i, res.exitIdx), pnlPct: res.pnlPct, stopLossPct: e.stopLossPct, won: res.pnlUsd > 0 });
    }
    return { tr, oob };
  };
  const stats = (tr: Tr[]) => {
    const n = tr.length; const wins = tr.filter((x) => x.pnlUsd > 0).length;
    const exp = n ? tr.reduce((s, x) => s + x.pnlPct, 0) / n : 0;
    const winAvg = wins ? tr.filter((x) => x.pnlUsd > 0).reduce((s, x) => s + x.pnlPct, 0) / wins : 0;
    const lossAvg = n - wins ? tr.filter((x) => x.pnlUsd <= 0).reduce((s, x) => s + x.pnlPct, 0) / (n - wins) : 0;
    return { n, wins, hit: n ? wins / n : 0, exp, usd: tr.reduce((s, x) => s + x.pnlUsd, 0), winAvg, lossAvg, worst: n ? Math.min(...tr.map((x) => x.pnlPct)) : 0 };
  };

  const CURRENT: Cfg = { e: { thr: 0.65, bv: 1, minLiq: 0, maxH1: Infinity }, x: null };
  const grid: Cfg[] = [];
  const exits: Array<FirstPartial | null> = [null];
  for (const v of [15, 20, 25]) for (const s of [50, 60]) exits.push({ mode: 'pct', value: v, sellPct: s });
  for (const v of [1, 1.5]) for (const s of [50, 60]) exits.push({ mode: 'r', value: v, sellPct: s });
  for (const thr of [0.6, 0.65, 0.7, 0.75]) for (const bv of [0, 1, 2]) for (const minLiq of [0, 30_000, 60_000]) for (const maxH1 of [Infinity, 30])
    for (const x of exits) grid.push({ e: { thr, bv, minLiq, maxH1 }, x });

  const span = t1 - t0;
  const edge = (k: number) => t0 + (span * k) / FOLDS;
  console.log(`${rows.length} eligible decisions ($25k-$5M) over ${(span / 86400).toFixed(1)} days, ${series.length} pools; ${grid.length} configs; ${FOLDS} time folds, walk-forward on folds 2..${FOLDS - 1}`);
  // Precompute every config on every fold boundary range (anchored train [0,k), test [k,k+1)).
  const oos: { cur: Tr[]; best: Tr[]; picks: string[] } = { cur: [], best: [], picks: [] };
  const MIN_TRAIN_N = 8;
  for (let k = 2; k < FOLDS; k++) {
    const trainFrom = edge(0), trainTo = edge(k), testTo = k === FOLDS - 1 ? Infinity : edge(k + 1);
    let bestC: Cfg | null = null; let bestS: ReturnType<typeof stats> | null = null;
    const curTrain = stats(run(CURRENT, trainFrom, trainTo).tr);
    for (const c of grid) {
      const s = stats(run(c, trainFrom, trainTo).tr);
      if (s.n < MIN_TRAIN_N || s.exp <= 0 || s.exp < curTrain.exp) continue; // higher win rate WITHOUT giving up expectancy
      if (!bestS || s.hit > bestS.hit + 1e-9 || (Math.abs(s.hit - bestS.hit) < 1e-9 && s.exp > bestS.exp)) { bestS = s; bestC = c; }
    }
    const pick = bestC ?? CURRENT;
    const curTest = run(CURRENT, trainTo, testTo).tr; const pickTest = run(pick, trainTo, testTo).tr;
    oos.cur.push(...curTest); oos.best.push(...pickTest); oos.picks.push(key(pick));
    const a = stats(curTest), b = stats(pickTest);
    console.log(`fold ${k}: train cur n${curTrain.n} hit ${(curTrain.hit * 100).toFixed(0)}% exp ${curTrain.exp.toFixed(2)}% | pick [${key(pick)}] train n${bestS?.n ?? '-'} hit ${bestS ? (bestS.hit * 100).toFixed(0) : '-'}% exp ${bestS?.exp.toFixed(2) ?? '-'}%`);
    console.log(`        TEST cur n${a.n} hit ${(a.hit * 100).toFixed(0)}% exp ${a.exp.toFixed(2)}% $${a.usd.toFixed(2)} | pick n${b.n} hit ${(b.hit * 100).toFixed(0)}% exp ${b.exp.toFixed(2)}% $${b.usd.toFixed(2)}`);
  }
  const A = stats(oos.cur), B = stats(oos.best);
  console.log(`\nOOS walk-forward total: CURRENT n${A.n} win ${(A.hit * 100).toFixed(1)}% avg ${A.exp.toFixed(2)}% (win avg ${A.winAvg.toFixed(1)} / loss avg ${A.lossAvg.toFixed(1)}) $${A.usd.toFixed(2)} worst ${A.worst.toFixed(1)}%`);
  console.log(`OOS walk-forward total: PICKED  n${B.n} win ${(B.hit * 100).toFixed(1)}% avg ${B.exp.toFixed(2)}% (win avg ${B.winAvg.toFixed(1)} / loss avg ${B.lossAvg.toFixed(1)}) $${B.usd.toFixed(2)} worst ${B.worst.toFixed(1)}%`);

  // Fixed-config view: each config's full OOS (folds 2..end), for robustness (does one config win every fold?).
  const table: Array<{ k: string; c: Cfg; s: ReturnType<typeof stats>; folds: number[] }> = [];
  for (const c of grid) {
    const tr: Tr[] = []; const folds: number[] = [];
    for (let k = 2; k < FOLDS; k++) { const x = run(c, edge(k), k === FOLDS - 1 ? Infinity : edge(k + 1)).tr; tr.push(...x); folds.push(stats(x).exp); }
    table.push({ k: key(c), c, s: stats(tr), folds });
  }
  const curRow = table.find((r) => r.k === key(CURRENT))!;
  const better = table.filter((r) => r.s.n >= 15 && r.s.exp > 0 && r.s.exp >= curRow.s.exp && r.s.hit > curRow.s.hit).sort((a, b) => b.s.hit - a.s.hit || b.s.exp - a.s.exp);
  console.log(`\nfixed configs over the same OOS folds (n>=15, exp>0, exp>=current, hit>current): ${better.length}`);
  console.log(`CURRENT ${key(CURRENT)}: n${curRow.s.n} win ${(curRow.s.hit * 100).toFixed(1)}% avg ${curRow.s.exp.toFixed(2)}% folds ${curRow.folds.map((f) => f.toFixed(1)).join('/')}`);
  for (const r of better.slice(0, 15)) console.log(`${r.k}: n${r.s.n} win ${(r.s.hit * 100).toFixed(1)}% avg ${r.s.exp.toFixed(2)}% $${r.s.usd.toFixed(2)} worst ${r.s.worst.toFixed(1)} folds ${r.folds.map((f) => f.toFixed(1)).join('/')}`);
  // Exit-only variants with the current entry filters.
  console.log('\nexit variants with CURRENT entries (OOS folds):');
  for (const r of table.filter((r) => JSON.stringify(r.c.e) === JSON.stringify(CURRENT.e))) console.log(`${r.k}: n${r.s.n} win ${(r.s.hit * 100).toFixed(1)}% avg ${r.s.exp.toFixed(2)}% $${r.s.usd.toFixed(2)} folds ${r.folds.map((f) => f.toFixed(1)).join('/')}`);
  // Owner rule (Nov 11): 5m volume >= $1,500 at entry and a hard exit when a later 5m candle is below it.
  console.log('\n$1,500 5m-volume floor (entry + exit), OOS folds:');
  const lvRows: Array<{ k: string; s: ReturnType<typeof stats>; folds: number[] }> = [];
  for (const x of [null, { mode: 'pct', value: 20, sellPct: 60 } as FirstPartial]) for (const thr of [0.65, 0.7, 0.75]) for (const lv of [0, 1500]) {
    const c: Cfg = { e: { ...CURRENT.e, thr, lv }, x }; const tr: Tr[] = []; const folds: number[] = [];
    for (let k = 2; k < FOLDS; k++) { const y = run(c, edge(k), k === FOLDS - 1 ? Infinity : edge(k + 1)).tr; tr.push(...y); folds.push(stats(y).exp); }
    const st = stats(tr); const kk = `${key(c)} lv${lv}`; lvRows.push({ k: kk, s: st, folds });
    console.log(`${kk}: n${st.n} win ${(st.hit * 100).toFixed(1)}% avg ${st.exp.toFixed(2)}% $${st.usd.toFixed(2)} worst ${st.worst.toFixed(1)} folds ${folds.map((f) => f.toFixed(1)).join('/')}`);
  }
  fs.writeFileSync('docs/backtest/win-rate.json', JSON.stringify({ at: new Date().toISOString(), rows: rows.length, days: span / 86400, pools: series.length, folds: FOLDS, walkForward: { current: A, picked: B, picks: oos.picks }, current: { key: curRow.k, ...curRow.s, folds: curRow.folds }, lowVol1500: lvRows, better: better.slice(0, 30).map((r) => ({ key: r.k, ...r.s, folds: r.folds })) }, null, 2));
  void HARD_BOUNDS; void ({} as TpRung);
}
main().catch((e) => { console.error(e); process.exit(1); });
