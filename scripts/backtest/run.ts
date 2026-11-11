/**
 * Cletus backtest / evaluation harness.
 *
 *   npx tsx --env-file=.env.local scripts/backtest/run.ts [--out docs/backtest] [--train 0.6]
 *
 * Replays market_data.ohlcv_5m through the REAL scanner code (rankCandidates → computeSignals → compositeScore with the
 * fee penalty) at every 5-minute close, with no lookahead, and simulates trades with the REAL exit rules (exitDecision,
 * partialTakeProfit ladder), AMM fill model (simFillPrice) and Jupiter V2 fee schedule (expectedFeeBps: 50 bps/side under
 * 24 h, 10 bps after; operator fee 50 bps where it applies). Tuning uses only the training window; results are reported
 * on the later, unseen test window, plus a 3-fold walk-forward. Read-only on the app schema; places no trades.
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildConfig, SIGNAL_NAMES, MCAP_PRESETS, type McapPreset, type SignalName, type Config } from '../../src/lib/config';
import { rankCandidates } from '../../src/lib/signals';
import { expectedFeeBps, feePenalty } from '../../src/lib/jupiter';
import { snapshotAt, simulateTrade, volumePrefix, tradeStats, spearman, reliability, isotonic, brier, wilson, BAR_SEC, type Bar, type PoolMeta, type TradeResult, type CostModel } from '../../src/lib/backtest/replay';
import { computeFeatures, FEATURE_NAMES, type FeatureName } from '../../src/lib/backtest/features';
import type { ExitParams } from '../../src/lib/exits';

const argv = process.argv;
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i > 0 ? argv[i + 1] : d; };
const OUT = arg('out', 'docs/backtest');
const TRAIN_FRAC = Number(arg('train', '0.6'));
const SIZE_USD = Number(arg('size', '500'));
const PRESETS: McapPreset[] = ['DEGEN', 'BALANCED', 'SAFER'];
type Key = SignalName | FeatureName;
const ALL_KEYS: Key[] = [...SIGNAL_NAMES, ...FEATURE_NAMES];

function pgClient(url: string) { const u = new URL(url); u.searchParams.delete('sslmode'); u.searchParams.delete('schema'); return new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } }); }

interface Row {
  pool: number; i: number; t: number; ageH: number | null; estFeeBps: number; feeOwner: number; feeCust: number;
  x: Record<Key, number>; liveComposite: number; fwd60: number | null;
}

async function loadData() {
  const md = pgClient(process.env.MARKET_DATA_DATABASE_URL!); await md.connect();
  const pools = (await md.query(`
    select p.address, p.base_mint, p.base_symbol, p.dex, s.price_usd, s.fdv_usd, s.mcap_usd, s.reserve_usd, s.pool_created_at, s.discovered_via
    from market_data.pools p join lateral (select * from market_data.pool_snapshots s where s.pool = p.address order by taken_at desc limit 1) s on true`)).rows;
  const bars = (await md.query(`select pool, extract(epoch from bucket)::bigint as t, open, high, low, close, volume_usd from market_data.ohlcv_5m order by pool, bucket`)).rows;
  await md.end();
  const byPool = new Map<string, Bar[]>();
  for (const r of bars) { const a = byPool.get(r.pool) ?? []; a.push({ t: Number(r.t), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume_usd) }); byPool.set(r.pool, a); }
  const metas: PoolMeta[] = []; const series: Bar[][] = []; const via: string[] = [];
  for (const p of pools) {
    const b = byPool.get(p.address); const price = Number(p.price_usd); const fdv = Number(p.fdv_usd ?? p.mcap_usd);
    if (!b || b.length < 100 || !(price > 0) || !(fdv > 0)) continue;
    metas.push({ pool: p.address, mint: p.base_mint, symbol: p.base_symbol ?? '?', dex: p.dex, supply: fdv / price, createdAtMs: p.pool_created_at ? new Date(p.pool_created_at).getTime() : null, liqNow: p.reserve_usd ? Number(p.reserve_usd) : null, priceNow: price });
    series.push(b); via.push(p.discovered_via ?? '?');
  }
  let live: Record<SignalName, number> | null = null;
  try {
    const app = pgClient(process.env.DATABASE_URL!); await app.connect(); await app.query('set search_path=app');
    const w = (await app.query(`select name, weight from "SignalWeight"`)).rows;
    if (w.length === SIGNAL_NAMES.length) live = Object.fromEntries(w.map((r) => [r.name, Number(r.weight)])) as Record<SignalName, number>;
    await app.end();
  } catch { /* app DB optional */ }
  const hash = crypto.createHash('sha256'); for (const s of series) hash.update(`${s.length}:${s[0].t}:${s[s.length - 1].t}:${s[s.length - 1].c};`);
  return { metas, series, via, live, datasetHash: hash.digest('hex').slice(0, 12) };
}

function exitParamsOf(c: Config, o: Partial<ExitParams> = {}): ExitParams {
  return { stopLossPct: c.stopLossPct, takeProfitPct: c.takeProfitPct, breakEvenTriggerPct: c.breakEvenTriggerPct, enableTrailingStop: c.enableTrailingStop, trailingStopPct: c.trailingStopPct, holdTimeMinutes: c.holdTimeMinutes, stalePositionMinutes: c.stalePositionMinutes, staleBandPct: c.staleBandPct, ...o };
}

const fmt = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? (x === Infinity ? '∞' : '–') : x.toFixed(d));
const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(d)}%`);

async function main() {
  const t0 = Date.now();
  const { metas, series, via, live, datasetHash } = await loadData();
  const prefixes = series.map(volumePrefix);
  const datasetEnd = Math.max(...series.map((s) => s[s.length - 1].t + BAR_SEC));
  const datasetStart = Math.min(...series.map((s) => s[0].t));
  const nCandles = series.reduce((s, x) => s + x.length, 0);
  console.log(`loaded ${metas.length} pools, ${nCandles} candles, ${new Date(datasetStart * 1000).toISOString()} → ${new Date(datasetEnd * 1000).toISOString()} (hash ${datasetHash})`);

  // Snapshots (shared by all presets) + forward 60-min raw return for IC.
  const snaps = series.map((bars, p) => bars.map((_, i) => snapshotAt(bars, i, metas[p], prefixes[p])));

  const report: any = { generatedAt: new Date().toISOString(), datasetHash, pools: metas.length, candles: nCandles, start: new Date(datasetStart * 1000).toISOString(), end: new Date(datasetEnd * 1000).toISOString(), discoveredVia: via.reduce((m: any, v) => ((m[v] = (m[v] ?? 0) + 1), m), {}), sizeUsd: SIZE_USD, presets: {} };

  for (const preset of PRESETS) {
    const cfg = buildConfig({ ...process.env, MCAP_PRESET: preset, MIN_MARKET_CAP: undefined, MAX_MARKET_CAP: undefined });
    const liveW = live ?? cfg.initialWeights;
    const rows: Row[] = []; const rejects: Record<string, number> = {}; let considered = 0;
    const poolsSeen = new Set<number>();
    for (let p = 0; p < series.length; p++) {
      const bars = series[p];
      for (let i = 0; i < bars.length; i++) {
        const s = snaps[p][i]; if (!s) continue;
        considered++;
        const nowMs = (bars[i].t + BAR_SEC) * 1000;
        const c = rankCandidates([s], cfg, liveW, nowMs)[0];
        if (c.rejected) { const k = c.rejected.replace(/\$[\d,.]+(-\$[\d,.]+)?/g, '$X').replace(/\d+(\.\d+)?/g, 'N'); rejects[k] = (rejects[k] ?? 0) + 1; continue; }
        poolsSeen.add(p);
        const feats = computeFeatures(s, bars, i);
        const j = i + 12 < bars.length && bars[i + 12].t - bars[i].t <= 3900 ? i + 12 : -1;
        rows.push({
          pool: p, i, t: bars[i].t + BAR_SEC, ageH: c.ageHours, estFeeBps: c.estFeeBps ?? 10,
          feeOwner: expectedFeeBps(c.ageHours, process.env, { chargeOperatorFee: false }), feeCust: expectedFeeBps(c.ageHours, process.env, { chargeOperatorFee: true }),
          x: { ...c.signals, ...feats }, liveComposite: c.composite, fwd60: j > 0 ? bars[j].c / bars[i].c - 1 : null,
        });
      }
    }
    console.log(`${preset}: ${considered} snapshots, ${rows.length} eligible decisions over ${poolsSeen.size} pools`);
    const P: any = { label: MCAP_PRESETS[preset].label, snapshots: considered, eligible: rows.length, eligiblePools: poolsSeen.size, rejects, liveThreshold: cfg.minCompositeScore, exits: exitParamsOf(cfg), ladder: cfg.tpLadder };
    report.presets[preset] = P;
    if (rows.length < 50) { P.note = 'too few eligible decisions to evaluate'; continue; }

    // ── outcome cache per (row, exit config, cost) ──
    const netUsd = (5000 + cfg.priorityFeeLamports) / 1e9 * cfg.solPriceFallbackUsd;
    const cost = (fee: number): CostModel => ({ feeBps: fee, slippageBps: 30, stopSlippageBps: 100, networkUsdPerSide: netUsd });
    const cache = new Map<string, TradeResult | null>();
    const outcome = (r: Row, ek: string, e: ExitParams, who: 'owner' | 'cust') => {
      const k = `${r.pool}:${r.i}:${ek}:${who}`;
      if (!cache.has(k)) cache.set(k, simulateTrade(series[r.pool], r.i, metas[r.pool], e, cfg.tpLadder, cost(who === 'owner' ? r.feeOwner : r.feeCust), SIZE_USD, datasetEnd));
      return cache.get(k)!;
    };
    const E0 = exitParamsOf(cfg);

    // ── time split ──
    const ts = rows.map((r) => r.t).sort((a, b) => a - b);
    const tMin = ts[0], tMax = ts[ts.length - 1];
    const tSplit = tMin + TRAIN_FRAC * (tMax - tMin);
    P.split = { trainFrom: new Date(tMin * 1000).toISOString(), testFrom: new Date(tSplit * 1000).toISOString(), testTo: new Date(tMax * 1000).toISOString() };

    type Scorer = (r: Row) => number;
    const linScorer = (w: Partial<Record<Key, number>>): Scorer => {
      const ks = (Object.keys(w) as Key[]).filter((k) => (w[k] ?? 0) > 0); const tot = ks.reduce((s, k) => s + w[k]!, 0);
      return (r) => Math.max(0, ks.reduce((s, k) => s + r.x[k] * w[k]!, 0) / tot - feePenalty(r.estFeeBps));
    };
    // Portfolio replay: one position per pool, ≤ maxOpenPositions, ≤ maxTotalExposurePct of $10k, fixed clip.
    const simulate = (score: Scorer, thr: number, from: number, to: number, ek = 'E0', e = E0, who: 'owner' | 'cust' = 'owner') => {
      const cands = rows.filter((r) => r.t >= from && r.t < to).map((r) => ({ r, s: score(r) })).filter((x) => x.s >= thr).sort((a, b) => a.r.t - b.r.t || b.s - a.s);
      const open: Array<{ pool: number; exit: number }> = []; const trades: Array<TradeResult & { score: number }> = [];
      const maxOpen = Math.min(cfg.maxOpenPositions, Math.floor((10_000 * cfg.maxTotalExposurePct) / 100 / SIZE_USD));
      for (const { r, s } of cands) {
        for (let k = open.length - 1; k >= 0; k--) if (open[k].exit <= r.t) open.splice(k, 1);
        if (open.length >= maxOpen || open.some((o) => o.pool === r.pool)) continue;
        const o = outcome(r, ek, e, who); if (!o || o.censored || o.exitTime > to) continue; // purge trades that leak past the window
        open.push({ pool: r.pool, exit: o.exitTime }); trades.push({ ...o, score: s });
      }
      return trades.sort((a, b) => a.exitTime - b.exitTime);
    };
    const lcb = (tr: Array<{ pnlPct: number }>) => { const n = tr.length; if (n < 12) return -Infinity; const m = tr.reduce((s, t) => s + t.pnlPct, 0) / n; const sd = Math.sqrt(tr.reduce((s, t) => s + (t.pnlPct - m) ** 2, 0) / (n - 1)); return m - sd / Math.sqrt(n); };

    // ── information coefficients (per signal / feature) on train and test ──
    const label = (r: Row) => { const o = outcome(r, 'E0', E0, 'owner'); return o && !o.censored ? o.pnlPct : null; };
    const icTable: any = {};
    for (const part of ['train', 'test'] as const) {
      const sub = rows.filter((r) => (part === 'train' ? r.t < tSplit : r.t >= tSplit));
      const lab = sub.map(label); const ok = sub.map((_, k) => lab[k] !== null);
      const fw = sub.map((r) => r.fwd60); const okf = fw.map((v) => v !== null);
      for (const k of ALL_KEYS) {
        icTable[k] ??= {};
        icTable[k][part] = spearman(sub.filter((_, q) => ok[q]).map((r) => r.x[k]), lab.filter((v) => v !== null) as number[]);
        icTable[k][`${part}Fwd60`] = spearman(sub.filter((_, q) => okf[q]).map((r) => r.x[k]), fw.filter((v) => v !== null) as number[]);
      }
      icTable.liveComposite ??= {};
      icTable.liveComposite[part] = spearman(sub.filter((_, q) => ok[q]).map((r) => r.liveComposite), lab.filter((v) => v !== null) as number[]);
      icTable.liveComposite[`${part}Fwd60`] = spearman(sub.filter((_, q) => okf[q]).map((r) => r.liveComposite), fw.filter((v) => v !== null) as number[]);
    }
    P.ic = icTable;

    // ── candidate scorers, fit on TRAIN only ──
    const trainRows = rows.filter((r) => r.t < tSplit);
    const trainIc = (k: Key) => { const lab = trainRows.map(label); const ok = lab.map((v) => v !== null); return spearman(trainRows.filter((_, q) => ok[q]).map((r) => r.x[k]), lab.filter((v) => v !== null) as number[]) ?? 0; };
    const icW = (keys: Key[]) => Object.fromEntries(keys.map((k) => [k, Math.max(0, trainIc(k))]).filter(([, v]) => (v as number) > 0.005)) as Partial<Record<Key, number>>;
    const scorers: Record<string, Partial<Record<Key, number>>> = {
      live: liveW, defaults: cfg.initialWeights,
      icBase: icW([...SIGNAL_NAMES]), icAll: icW(ALL_KEYS),
      icShippable: icW(ALL_KEYS.filter((k) => k !== 'higherLows')),
    };
    for (const [k, w] of Object.entries(scorers)) if (!Object.values(w).some((v) => (v ?? 0) > 0)) delete scorers[k];
    const thresholds = Array.from({ length: 29 }, (_, k) => +(0.2 + k * 0.025).toFixed(3));

    const exitGrid: Array<[string, ExitParams]> = [['E0', E0]];
    for (const hold of [6, 15, 30, 60, 120]) for (const sl of [5, 10]) for (const tp of [15, 25]) exitGrid.push([`hold${hold}_sl${sl}_tp${tp}`, exitParamsOf(cfg, { holdTimeMinutes: hold, stopLossPct: sl, takeProfitPct: tp })]);
    const exitByKey = new Map(exitGrid);
    const select = (from: number, to: number, withExits = false) => {
      let best = { name: 'live', thr: cfg.minCompositeScore, ek: 'E0', obj: -Infinity, n: 0 };
      for (const [ek, e] of withExits ? exitGrid : exitGrid.slice(0, 1)) for (const [name, w] of Object.entries(scorers)) {
        const sc = linScorer(w);
        for (const thr of thresholds) { const tr = simulate(sc, thr, from, to, ek, e); const obj = lcb(tr); if (obj > best.obj) best = { name, thr, ek, obj, n: tr.length }; }
      }
      return best;
    };
    const chosen = select(tMin, tSplit);
    P.chosen = chosen;
    const joint = select(tMin, tSplit, true);
    P.joint = joint;
    P.weights = Object.fromEntries(Object.entries(scorers).map(([k, w]) => { const tot = Object.values(w).reduce((s, v) => s + (v ?? 0), 0); return [k, Object.fromEntries(Object.entries(w).map(([kk, v]) => [kk, +((v ?? 0) / tot).toFixed(4)]))]; }));

    const summarize = (tr: TradeResult[]) => { const s = tradeStats(tr); const reasons: Record<string, number> = {}; for (const t of tr) reasons[t.reason] = (reasons[t.reason] ?? 0) + 1; return { ...s, reasons }; };
    const liveSc = linScorer(liveW), chosenSc = linScorer(scorers[chosen.name]);
    P.results = {
      baseline: { train: summarize(simulate(liveSc, cfg.minCompositeScore, tMin, tSplit)), test: summarize(simulate(liveSc, cfg.minCompositeScore, tSplit, tMax + 1)), testCustomer: summarize(simulate(liveSc, cfg.minCompositeScore, tSplit, tMax + 1, 'E0', E0, 'cust')) },
      chosen: { train: summarize(simulate(chosenSc, chosen.thr, tMin, tSplit)), test: summarize(simulate(chosenSc, chosen.thr, tSplit, tMax + 1)), testCustomer: summarize(simulate(chosenSc, chosen.thr, tSplit, tMax + 1, 'E0', E0, 'cust')) },
    };
    { const jSc = linScorer(scorers[joint.name]), jE = exitByKey.get(joint.ek)!;
      P.results.joint = { train: summarize(simulate(jSc, joint.thr, tMin, tSplit, joint.ek, jE)), test: summarize(simulate(jSc, joint.thr, tSplit, tMax + 1, joint.ek, jE)), testCustomer: summarize(simulate(jSc, joint.thr, tSplit, tMax + 1, joint.ek, jE, 'cust')) }; }
    // Matched-volume ranking test (threshold-free): mean net return of the top-q% TEST decisions by each scorer.
    { const te = rows.filter((r) => r.t >= tSplit).map((r) => ({ r, o: outcome(r, 'E0', E0, 'owner') })).filter((x) => x.o && !x.o.censored);
      P.matchedTest = Object.fromEntries(Object.entries(scorers).map(([name, w]) => { const sc = linScorer(w); const sorted = te.map((x) => ({ s: sc(x.r), ret: x.o!.pnlPct })).sort((a, b) => b.s - a.s);
        return [name, [0.02, 0.05, 0.1, 0.25, 1].map((q) => { const k = Math.max(1, Math.round(sorted.length * q)); const top = sorted.slice(0, k); return { q, n: k, meanNetPct: top.reduce((a, b) => a + b.ret, 0) / k, winRate: top.filter((t) => t.ret > 0).length / k }; })]; }));
      P.atLiveThresholdTest = Object.fromEntries(Object.entries(scorers).map(([name, w]) => [name, tradeStats(simulate(linScorer(w), cfg.minCompositeScore, tSplit, tMax + 1))])); }
    // Threshold sweep for the live weights on the TEST window (descriptive only; not used for selection).
    P.liveThresholdSweepTest = [0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75].map((thr) => { const s = tradeStats(simulate(liveSc, thr, tSplit, tMax + 1)); return { thr, n: s.n, hit: s.hitRate, exp: s.expectancyPct }; });
    P.liveThresholdSweepTrain = [0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75].map((thr) => { const s = tradeStats(simulate(liveSc, thr, tMin, tSplit)); return { thr, n: s.n, hit: s.hitRate, exp: s.expectancyPct }; });

    // ── walk-forward (4 time chunks, 3 folds: fit on chunks ≤ k, test on k+1) ──
    const edges = [0, 1, 2, 3, 4].map((k) => tMin + (k / 4) * (tMax + 1 - tMin));
    const wfBase: TradeResult[] = [], wfChosen: TradeResult[] = [], wfJoint: TradeResult[] = []; const wfPicks: any[] = [];
    for (let k = 1; k <= 3; k++) {
      const pick = select(edges[0], edges[k]);
      wfPicks.push({ fold: k, ...pick });
      wfChosen.push(...simulate(linScorer(scorers[pick.name]), pick.thr, edges[k], edges[k + 1]));
      wfBase.push(...simulate(liveSc, cfg.minCompositeScore, edges[k], edges[k + 1]));
      const jp = select(edges[0], edges[k], true); wfPicks.push({ fold: k, joint: true, ...jp });
      wfJoint.push(...simulate(linScorer(scorers[jp.name]), jp.thr, edges[k], edges[k + 1], jp.ek, exitByKey.get(jp.ek)!));
    }
    P.walkForward = { picks: wfPicks, baseline: summarize(wfBase), chosen: summarize(wfChosen), joint: summarize(wfJoint) };

    // ── calibration: score → P(win) with isotonic fit on train, reliability + Brier on test ──
    const calib = (sc: Scorer) => {
      const pts = (part: 'train' | 'test') => rows.filter((r) => (part === 'train' ? r.t < tSplit : r.t >= tSplit)).map((r) => ({ r, o: outcome(r, 'E0', E0, 'owner') })).filter((x) => x.o && !x.o.censored).map((x) => ({ score: sc(x.r), retPct: x.o!.pnlPct }));
      const tr = pts('train'), te = pts('test');
      const iso = isotonic(tr.map((p) => ({ x: p.score, y: p.retPct > 0 ? 1 : 0 })));
      const predict = (s: number) => { let y = iso[0]?.y ?? 0; for (const b of iso) if (s >= b.x) y = b.y; return y; };
      const base = tr.filter((p) => p.retPct > 0).length / Math.max(1, tr.length);
      const e = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.01];
      return { trainN: tr.length, testN: te.length, baseWinRateTrain: base, brierModel: brier(te.map((p) => ({ p: predict(p.score), won: p.retPct > 0 }))), brierBase: brier(te.map((p) => ({ p: base, won: p.retPct > 0 }))), reliabilityTest: reliability(te, e), reliabilityTrain: reliability(tr, e), iso: compressIso(iso) };
    };
    P.calibration = { live: calib(liveSc), chosen: calib(chosenSc) };
    { const all = rows.map((r) => ({ r, o: outcome(r, 'E0', E0, 'owner') })).filter((x) => x.o && !x.o.censored).map((x) => ({ score: liveSc(x.r), retPct: x.o!.pnlPct }));
      const wins = all.filter((x) => x.retPct > 0).length; const w = wilson(wins, all.length);
      const cl = P.calibration.live;
      P.brainCalibration = { n: all.length, pools: poolsSeen.size, baseWinRate: all.length ? wins / all.length : null, baseCi: w, meanNetPct: all.length ? all.reduce((a, b) => a + b.retPct, 0) / all.length : null,
        scorePredictive: cl.brierModel !== null && cl.brierBase !== null && cl.brierModel < 0.98 * cl.brierBase /* must beat the base rate by ≥2% out of sample */, testIcLive: P.ic.liveComposite.test,
        buckets: reliability(all, [0, 0.3, 0.5, 0.6, 0.7, 0.8, 1.01]).map((b) => ({ ...b, hi: Math.min(1, b.hi) })) }; }

    // ── exit sensitivity (recommendation only; selected on train, reported on test) ──
    const ex = exitGrid.slice(1).map(([k, e]) => { const tr = simulate(chosenSc, chosen.thr, tMin, tSplit, k, e); const te = simulate(chosenSc, chosen.thr, tSplit, tMax + 1, k, e); return { k, train: tradeStats(tr), test: tradeStats(te), obj: lcb(tr) }; });
    ex.sort((a, b) => b.obj - a.obj);
    P.exitSensitivity = ex.slice(0, 6).map((x) => ({ k: x.k, trainN: x.train.n, trainExp: x.train.expectancyPct, testN: x.test.n, testExp: x.test.expectancyPct, testHit: x.test.hitRate, testPF: x.test.profitFactor }));
    P.exitCurrent = { k: `hold${cfg.holdTimeMinutes}_sl${cfg.stopLossPct}_tp${cfg.takeProfitPct}` };
    console.log(`${preset}: chosen ${chosen.name}@${chosen.thr} (train n=${chosen.n}); test baseline exp ${fmt(P.results.baseline.test.expectancyPct)}% n=${P.results.baseline.test.n} vs chosen ${fmt(P.results.chosen.test.expectancyPct)}% n=${P.results.chosen.test.n}`);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(report, (_, v) => (v === Infinity ? 'Infinity' : v), 2));
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), renderReport(report));
  const calIdx = argv.indexOf('--write-calibration');
  if (calIdx > 0) {
    const file = argv[calIdx + 1];
    const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { clips: {} };
    prev.generatedAt = report.generatedAt; prev.datasetHash = report.datasetHash; prev.range = { start: report.start, end: report.end }; prev.pools = report.pools;
    prev.method = 'Walk-forward backtest of the live score on GeckoTerminal 5m candles (scripts/backtest/run.ts). Net of Jupiter fees, AMM impact, slippage. Owner fee schedule (no operator fee).';
    prev.clips[String(SIZE_USD)] = Object.fromEntries(Object.entries<any>(report.presets).filter(([, P]) => P.brainCalibration).map(([k, P]) => [k, { ...P.brainCalibration, exits: P.exitCurrent.k, threshold: P.liveThreshold }]));
    fs.writeFileSync(file, JSON.stringify(prev, (_, v) => (typeof v === 'number' ? +v.toFixed(4) : v), 2) + '\n');
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${OUT}/REPORT.md`);
}

function compressIso(iso: Array<{ x: number; y: number; n: number }>) {
  const out: Array<{ x: number; y: number; n: number }> = [];
  for (const b of iso) { const last = out[out.length - 1]; if (last && Math.abs(last.y - b.y) < 1e-9) last.n += b.n; else out.push({ x: +b.x.toFixed(4), y: +b.y.toFixed(4), n: b.n }); }
  return out;
}

function renderReport(r: any): string {
  const L: string[] = [];
  L.push(`# Cletus backtest report`, '', `Generated ${r.generatedAt} · dataset ${r.datasetHash} · ${r.pools} pools · ${r.candles.toLocaleString()} five-minute candles · ${r.start} → ${r.end} (UTC) · clip $${r.sizeUsd}`, '');
  L.push(`Pools by discovery source: ${Object.entries(r.discoveredVia).map(([k, v]) => `${k} ${v}`).join(', ')}`, '');
  L.push('All returns are net of Jupiter fees (50 bps/side under 24 h, 10 bps after), AMM price impact, 30 bps/side slippage, +100 bps on stop-type exits, and network fees. "Owner" = no operator fee; "customer" = 0.5% operator fee per side. Test = later, unseen time window.', '');
  for (const [name, P] of Object.entries<any>(r.presets)) {
    L.push(`## ${P.label}`, '', `Snapshots ${P.snapshots.toLocaleString()} · eligible after filters ${P.eligible.toLocaleString()} (${P.eligiblePools ?? 0} pools)`, '');
    if (P.note) { L.push(`_${P.note}_`, ''); continue; }
    L.push(`Split: train ${P.split.trainFrom} → ${P.split.testFrom}, test → ${P.split.testTo}`, '');
    L.push('| | trades | hit rate | avg win | avg loss | expectancy | profit factor | max DD | Sharpe/trade |', '|---|---|---|---|---|---|---|---|---|');
    const row = (k: string, s: any) => L.push(`| ${k} | ${s.n} | ${pct(s.hitRate)} | ${fmt(s.avgWinPct)}% | ${fmt(s.avgLossPct)}% | ${fmt(s.expectancyPct)}% | ${fmt(s.profitFactor)} | ${fmt(s.maxDrawdownPct)}% | ${fmt(s.sharpePerTrade)} |`);
    row(`baseline (live weights @ ${P.liveThreshold}) train`, P.results.baseline.train);
    row(`baseline TEST`, P.results.baseline.test);
    row(`baseline TEST (customer fee)`, P.results.baseline.testCustomer);
    row(`chosen (${P.chosen.name} @ ${P.chosen.thr}) train`, P.results.chosen.train);
    row(`chosen TEST`, P.results.chosen.test);
    row(`chosen TEST (customer fee)`, P.results.chosen.testCustomer);
    row(`joint score+exits (${P.joint.name} @ ${P.joint.thr}, ${P.joint.ek}) train`, P.results.joint.train);
    row('joint TEST', P.results.joint.test);
    row('joint TEST (customer fee)', P.results.joint.testCustomer);
    row('walk-forward baseline (3 folds OOS)', P.walkForward.baseline);
    row('walk-forward chosen (3 folds OOS)', P.walkForward.chosen);
    row('walk-forward joint (3 folds OOS)', P.walkForward.joint);
    L.push('', `Walk-forward picks: ${P.walkForward.picks.map((p: any) => `fold ${p.fold}${p.joint ? ' joint' : ''}: ${p.name}@${p.thr}${p.joint ? ` ${p.ek}` : ''}`).join('; ')}`, '');
    L.push('Ranking quality, threshold-free (TEST decisions; mean net return of the top q% by each score):', '', '| scorer | top 2% | top 5% | top 10% | top 25% | all |', '|---|---|---|---|---|---|');
    for (const [k, v] of Object.entries<any>(P.matchedTest)) L.push(`| ${k} | ${(v as any[]).map((x) => `${fmt(x.meanNetPct)}% (win ${pct(x.winRate, 0)}, n=${x.n})`).join(' | ')} |`);
    L.push('', `Each scorer at the live threshold ${P.liveThreshold} (TEST portfolio): ${Object.entries<any>(P.atLiveThresholdTest).map(([k, s]) => `${k}: n=${s.n}, exp ${fmt(s.expectancyPct)}%`).join('; ')}`, '');
    L.push('Live weights, threshold sweep (train | test):', '', '| threshold | train n | train exp | test n | test hit | test exp |', '|---|---|---|---|---|---|');
    P.liveThresholdSweepTest.forEach((t: any, k: number) => { const a = P.liveThresholdSweepTrain[k]; L.push(`| ${t.thr} | ${a.n} | ${fmt(a.exp)}% | ${t.n} | ${pct(t.hit)} | ${fmt(t.exp)}% |`); });
    L.push('', 'Information coefficient (Spearman of signal vs net trade return; and vs raw 60-min forward return):', '', '| signal | IC train | IC test | IC60 train | IC60 test |', '|---|---|---|---|---|');
    for (const [k, v] of Object.entries<any>(P.ic)) L.push(`| ${k} | ${fmt(v.train, 3)} | ${fmt(v.test, 3)} | ${fmt(v.trainFwd60, 3)} | ${fmt(v.testFwd60, 3)} |`);
    for (const which of ['live', 'chosen']) {
      const c = P.calibration[which];
      L.push('', `Calibration (${which} score; isotonic fit on train). Test Brier ${fmt(c.brierModel, 4)} vs base-rate ${fmt(c.brierBase, 4)} (lower is better). Train win rate ${pct(c.baseWinRateTrain)}.`, '', '| score bucket | test n | test win rate (95% CI) | test mean net |', '|---|---|---|---|');
      for (const b of c.reliabilityTest) L.push(`| ${b.lo}–${Math.min(1, b.hi)} | ${b.n} | ${pct(b.winRate)} (${pct(b.wilsonLo, 0)}–${pct(b.wilsonHi, 0)}) | ${fmt(b.meanRetPct)}% |`);
    }
    L.push('', `Exit sensitivity (chosen score; ranked on train; current ${P.exitCurrent.k}):`, '', '| exits | train n | train exp | test n | test hit | test exp | test PF |', '|---|---|---|---|---|---|---|');
    for (const e of P.exitSensitivity) L.push(`| ${e.k} | ${e.trainN} | ${fmt(e.trainExp)}% | ${e.testN} | ${pct(e.testHit)} | ${fmt(e.testExp)}% | ${fmt(e.testPF)} |`);
    L.push('', `Top filter rejections: ${Object.entries<number>(P.rejects).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} (${v})`).join('; ')}`, '');
  }
  return L.join('\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
