/**
 * Nightly self-retraining of the live entry score (liquidity weight set + MIN_COMPOSITE_SCORE). Read-only on market
 * data and the app DB; the only writes are data/weight-sets/registry.json (with --apply) and logs/retrain.jsonl.
 * Never trades, never moves funds, never touches the live worker process.
 *
 *   npx tsx --env-file=.env.local scripts/retrain-weights.ts              # dry run: report, change nothing
 *   npx tsx --env-file=.env.local scripts/retrain-weights.ts --apply      # promote if every gate passes
 *       [--if-due] [--seed N] [--size 6] [--days 14]
 *   npx tsx --env-file=.env.local scripts/retrain-weights.ts --status
 *   npx tsx --env-file=.env.local scripts/retrain-weights.ts --rollback [previous|default|<id>]
 *
 * Method: every scanner-eligible 5m snapshot ($70k-$5M, real rankCandidates filters) becomes a decision with its 6
 * liquidity terms. Trades replay with the live owner setup (1 open position, adaptive exit plan from the score,
 * fees + AMM impact + slippage, no lookahead). The newest 30% of time is held out. Candidates (current, every
 * single-term ±cap move, random bounded moves; x threshold steps) are ranked by walk-forward expectancy on 3
 * validation folds of the older 70%; only the winner is then compared with the current set on the holdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { buildConfig, applyOwnerPlan } from '../src/lib/config';
import { rankCandidates, liquidityTerms } from '../src/lib/signals';
import { expectedFeeBps, feePenalty } from '../src/lib/jupiter';
import type { ExitParams } from '../src/lib/exits';
import { computeExitPlan, planOverrides, regimeStats, type PriceChange, type RegimeStats } from '../src/lib/adaptive-exits';
import { snapshotAt, simulateTrade, volumePrefix, BAR_SEC, type Bar, type PoolMeta } from '../src/lib/backtest/replay';
import { DEFAULT_POLICY, decidePromotion, evaluate, type ClosedTrade, type Decision, type Simulate, type SimTrade } from '../src/lib/retrain/core';
import { activeVersion, isDue, logDecision, newVersionId, promote, readRegistry, rollback, writeRegistry } from '../src/lib/retrain/store';

const argv = process.argv;
const has = (k: string) => argv.includes(`--${k}`);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i > 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const pgc = (url: string) => { const u = new URL(url); u.searchParams.delete('sslmode'); u.searchParams.delete('schema'); return new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } }); };

const OWNER_ENV = { TRADING_MODE: 'simulation', MCAP_PRESET: 'BALANCED', MIN_MARKET_CAP: process.env.MIN_MARKET_CAP ?? '70000', MAX_MARKET_CAP: '5000000', OWNER_PLAN_ENABLED: 'true', SIGNAL_WEIGHT_SET: 'liquidity', ENABLE_TRAILING_STOP: 'false', HOLD_TIME_MINUTES: '10080', STALE_POSITION_MINUTES: '0' };
const baseCfg = () => applyOwnerPlan(buildConfig({ ...process.env, ...OWNER_ENV }), true);
const lockPath = () => path.join(process.cwd(), 'logs', 'retrain.lock');

function status() {
  const reg = readRegistry(baseCfg().minCompositeScore);
  const a = activeVersion(reg);
  console.log(`active: ${a.id} (threshold ${a.threshold}) previous: ${reg.previousId ?? '-'} lastRun: ${reg.lastRunAt ?? 'never'} -> ${reg.lastRunResult ?? '-'}`);
  for (const v of reg.versions) console.log(`  ${v.id === reg.activeId ? '*' : ' '} ${v.id} ${v.source} thr ${v.threshold} ${JSON.stringify(v.weights)}`);
}

async function main() {
  if (has('status')) return status();
  if (has('rollback')) {
    const target = arg('rollback', 'previous');
    const reg = readRegistry(baseCfg().minCompositeScore);
    const next = rollback(reg, target);
    if (!next) { console.error(`unknown rollback target ${target}`); process.exit(2); }
    writeRegistry(next);
    logDecision('rollback', { from: reg.activeId, to: next.activeId, target });
    console.log(`rolled back: ${reg.activeId} -> ${next.activeId} (worker picks it up on restart, or within 60s with WEIGHTS_HOT_RELOAD=on)`);
    return;
  }
  const apply = has('apply');
  const cfg = baseCfg();
  const reg0 = readRegistry(cfg.minCompositeScore);
  const everyH = Number(process.env.RETRAIN_EVERY_HOURS ?? 20) || 20;
  if (has('if-due') && !isDue(reg0, Date.now(), everyH)) { console.log(`not due (last run ${reg0.lastRunAt})`); return; }
  if (apply) {
    fs.mkdirSync(path.dirname(lockPath()), { recursive: true });
    try {
      const st = fs.statSync(lockPath());
      if (Date.now() - st.mtimeMs < 2 * 3_600_000) { console.log('another retrain is running (lock < 2h old)'); return; }
    } catch { /* no lock */ }
    fs.writeFileSync(lockPath(), String(process.pid));
  }
  try { await run(apply, cfg); } finally { if (apply) try { fs.unlinkSync(lockPath()); } catch { /* */ } }
}

async function run(apply: boolean, cfg: ReturnType<typeof baseCfg>) {
  const t0 = Date.now();
  const SIZE = Number(arg('size', '6'));
  const DAYS = Number(arg('days', '0'));
  const seed = Number(arg('seed', String(Math.floor(Date.now() / 86_400_000)))); // one seed per UTC day: reproducible
  const policy = { ...DEFAULT_POLICY };

  const md = pgc(process.env.MARKET_DATA_DATABASE_URL!); await md.connect();
  const since = DAYS > 0 ? `where bucket >= now() - interval '${Math.floor(DAYS)} days'` : '';
  const pools = (await md.query(`select p.address, p.base_mint, p.base_symbol, p.dex, s.price_usd, s.fdv_usd, s.mcap_usd, s.reserve_usd, s.pool_created_at
    from market_data.pools p join lateral (select * from market_data.pool_snapshots s where s.pool = p.address order by taken_at desc limit 1) s on true`)).rows;
  const bars = (await md.query(`select pool, extract(epoch from bucket)::bigint as t, open, high, low, close, volume_usd from market_data.ohlcv_5m ${since} order by pool, bucket`)).rows;
  await md.end();

  // Real closed trades (live + paper) for the IC veto. Optional: the retrain still runs without the app DB.
  const closed: ClosedTrade[] = [];
  try {
    const app = pgc(process.env.DATABASE_URL!); await app.connect(); await app.query('set search_path=app');
    const rows = (await app.query(`select signals, "pnlPct" from "Position" where status = 'closed' and "pnlPct" is not null`)).rows;
    await app.end();
    for (const r of rows) { try { const s = JSON.parse(r.signals); if (Number.isFinite(s.liquidityBuild) && Number.isFinite(s.velocitySurge)) closed.push({ liquidityBuild: s.liquidityBuild, velocitySurge: s.velocitySurge, momentum: s.momentum ?? 0, pnlPct: Number(r.pnlPct) }); } catch { /* */ } }
  } catch (e) { console.log(`closed trades unavailable (${(e as Error).message.slice(0, 80)}); IC veto skipped`); }

  const byPool = new Map<string, Bar[]>();
  for (const r of bars) { const a = byPool.get(r.pool) ?? []; a.push({ t: Number(r.t), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume_usd) }); byPool.set(r.pool, a); }
  const metas: PoolMeta[] = []; const series: Bar[][] = [];
  for (const p of pools) {
    const b = byPool.get(p.address); const price = Number(p.price_usd); const fdv = Number(p.fdv_usd ?? p.mcap_usd);
    if (!b || b.length < 100 || !(price > 0) || !(fdv > 0)) continue;
    metas.push({ pool: p.address, mint: p.base_mint, symbol: p.base_symbol ?? '?', dex: p.dex, supply: fdv / price, createdAtMs: p.pool_created_at ? new Date(p.pool_created_at).getTime() : null, liqNow: p.reserve_usd ? Number(p.reserve_usd) : null, priceNow: price });
    series.push(b);
  }
  if (!series.length) throw new Error('no market data');
  const end = Math.max(...series.map((s) => s[s.length - 1].t + BAR_SEC));
  const netUsd = ((5000 + cfg.priorityFeeLamports) / 1e9) * cfg.solPriceFallbackUsd;

  interface Ctx { p: number; i: number; fee: number; pc: PriceChange; liq: number | null }
  const decisions: Decision[] = []; const ctx = new Map<string, Ctx>(); const h1ByT = new Map<number, number[]>();
  for (let p = 0; p < series.length; p++) {
    const pre = volumePrefix(series[p]);
    for (let i = 0; i < series[p].length; i++) {
      const snap = snapshotAt(series[p], i, metas[p], pre); if (!snap) continue;
      const t = series[p][i].t + BAR_SEC;
      const c = rankCandidates([snap], cfg, cfg.initialWeights, t * 1000)[0];
      if (c.rejected) continue;
      const key = `${p}:${i}`;
      const fee = expectedFeeBps(c.ageHours, process.env, { chargeOperatorFee: false });
      decisions.push({ t, key, terms: liquidityTerms(c.signals, snap), feePen: feePenalty(c.estFeeBps ?? fee) });
      ctx.set(key, { p, i, fee, pc: snap.priceChange ?? {}, liq: c.liquidityUsd });
      const a = h1ByT.get(t) ?? []; a.push(snap.priceChange?.h1 ?? 0); h1ByT.set(t, a);
    }
  }
  const regimeAt = (t: number): RegimeStats => regimeStats(h1ByT.get(t) ?? [], t * 1000);
  const base: ExitParams = { stopLossPct: 5, takeProfitPct: 20, breakEvenTriggerPct: 1e9, enableTrailingStop: false, trailingStopPct: 8, holdTimeMinutes: 10080, stalePositionMinutes: 0, staleBandPct: 3 };
  const cache = new Map<string, SimTrade | null>();
  const sim: Simulate = (d, score) => {
    const x = ctx.get(d.key)!;
    const plan = computeExitPlan({ priceChange: x.pc, composite: score, liquidityUsd: x.liq, regime: regimeAt(d.t), history: [] });
    const o = planOverrides(plan);
    const ck = `${d.key}|${JSON.stringify(o)}`;
    if (cache.has(ck)) return cache.get(ck)!;
    const r = simulateTrade(series[x.p], x.i, metas[x.p], { ...base, ...o }, o.tpLadder, { feeBps: x.fee, slippageBps: 30, stopSlippageBps: 100, networkUsdPerSide: netUsd }, SIZE, end);
    const out = !r || r.censored ? null : { exitT: r.exitTime, pnlPct: r.pnlPct, pnlUsd: r.pnlUsd };
    cache.set(ck, out); return out;
  };

  const reg = readRegistry(cfg.minCompositeScore);
  const cur = activeVersion(reg);
  const curThr = cur.id === 'default' ? cfg.minCompositeScore : cur.threshold;
  const ev = evaluate(decisions, cur.weights, curThr, sim, policy, seed, closed);
  if (!ev) throw new Error('not enough decisions to split');
  const dec = decidePromotion(ev, policy, cur.weights, curThr);
  const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 16) + 'Z';
  const m = (x: typeof ev.current.holdout) => `n ${x.n} hit ${(x.hit * 100).toFixed(0)}% exp ${x.expPct.toFixed(2)}% sum ${x.sumPct.toFixed(1)}% $${x.usd.toFixed(2)} worst ${x.worstPct.toFixed(1)}%`;
  const summary = {
    mode: apply ? 'apply' : 'dry-run', seed, decisions: ev.decisions, pools: series.length, candidates: ev.candidatesTried, closedTrades: ev.closedTrades,
    window: { start: iso(ev.split.start), holdoutStart: iso(ev.split.holdoutStart), end: iso(ev.split.end) },
    current: { id: cur.id, threshold: curThr, weights: cur.weights, trainFitness: ev.current.train, holdout: ev.current.holdout, blocks: ev.current.blocks.map((b) => b.sumPct), ic: ev.current.ic },
    candidate: { label: ev.best.label, threshold: ev.best.threshold, weights: ev.best.weights, trainFitness: ev.best.train, holdout: ev.best.holdout, blocks: ev.best.blocks.map((b) => b.sumPct), ic: ev.best.ic },
    promote: dec.promote, reasons: dec.reasons, ms: Date.now() - t0,
  };
  console.log(`retrain ${summary.mode}: ${ev.decisions} decisions, ${series.length} pools, ${ev.candidatesTried} candidates, ${ev.closedTrades} closed trades; train ${summary.window.start}..${summary.window.holdoutStart}, holdout ..${summary.window.end}`);
  console.log(`current   ${cur.id} thr ${curThr.toFixed(3)} | train fit ${ev.current.train.toFixed(2)} | HOLDOUT ${m(ev.current.holdout)} | blocks sum% ${summary.current.blocks.map((x) => x.toFixed(2)).join(' / ')} | IC ${ev.current.ic ?? '-'}`);
  console.log(`candidate ${ev.best.label} | train fit ${ev.best.train.toFixed(2)} | HOLDOUT ${m(ev.best.holdout)} | blocks sum% ${summary.candidate.blocks.map((x) => x.toFixed(2)).join(' / ')} | IC ${ev.best.ic ?? '-'}`);
  console.log(`candidate weights ${JSON.stringify(Object.fromEntries(Object.entries(ev.best.weights).map(([k, v]) => [k, Number(v.toFixed(4))])))}`);
  console.log(`decision: ${dec.promote ? 'PROMOTE' : 'keep current'} - ${dec.reasons.join('; ')}`);

  let promotedId: string | null = null;
  if (apply) {
    let next = { ...reg, lastRunAt: new Date().toISOString(), lastRunResult: dec.promote ? 'promoted' : `kept: ${dec.reasons[0]}` };
    if (dec.promote) {
      promotedId = newVersionId();
      next = { ...promote(next, { id: promotedId, createdAt: new Date().toISOString(), source: 'retrain', weights: ev.best.weights, threshold: ev.best.threshold, parentId: cur.id, metrics: summary }), lastRunAt: next.lastRunAt, lastRunResult: `promoted ${promotedId}` };
    }
    writeRegistry(next);
  }
  logDecision(apply ? (dec.promote ? 'promote' : 'reject') : 'dry-run', { ...summary, promotedId });
  if (!apply) console.log('dry run: registry unchanged');
}

main().catch((e) => { console.error('retrain failed:', e instanceof Error ? e.message : e); logDecision('error', { message: e instanceof Error ? e.message : String(e) }); process.exit(1); });
