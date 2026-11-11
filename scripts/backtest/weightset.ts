/**
 * Quick out-of-sample comparison of signal weight sets (classic vs liquidity) for the LIVE owner setup:
 * $70k-$5M band, owner exits (SL/TP from the owner plan, no trailing, no ladder), 1 open position, small clip.
 * Same replay primitives as run.ts (no lookahead, fees + AMM impact + slippage). Read-only.
 *
 *   npx tsx --env-file=.env.local scripts/backtest/weightset.ts [--size 6] [--train 0.6]
 */
import pg from 'pg';
import { buildConfig, applyOwnerPlan, SIGNAL_NAMES, type SignalName } from '../../src/lib/config';
import { rankCandidates } from '../../src/lib/signals';
import { expectedFeeBps } from '../../src/lib/jupiter';
import { snapshotAt, simulateTrade, volumePrefix, BAR_SEC, type Bar, type PoolMeta, type TradeResult } from '../../src/lib/backtest/replay';

const argv = process.argv;
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i > 0 ? argv[i + 1] : d; };
const SIZE = Number(arg('size', '6'));
const TRAIN = Number(arg('train', '0.6'));
const THRS = arg('thr', '0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75').split(',').map(Number);
const pgc = (url: string) => { const u = new URL(url); u.searchParams.delete('sslmode'); u.searchParams.delete('schema'); return new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } }); };

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
  const base = { ...process.env, TRADING_MODE: 'simulation', MCAP_PRESET: 'BALANCED', MIN_MARKET_CAP: '70000', MAX_MARKET_CAP: '5000000', OWNER_PLAN_ENABLED: 'true', OWNER_STOP_LOSS_PCT: '5', OWNER_TAKE_PROFIT_PCT: '20', ENABLE_TRAILING_STOP: 'false', HOLD_TIME_MINUTES: '10080', STALE_POSITION_MINUTES: '0' };
  const days = (from: number, to: number) => Math.max(1e-9, (to - from) / 86400);

  for (const set of ['classic', 'liquidity'] as const) {
    const cfg = applyOwnerPlan(buildConfig({ ...base, SIGNAL_WEIGHT_SET: set }), true);
    const w = liveW ?? cfg.initialWeights;
    const e = { stopLossPct: cfg.stopLossPct, takeProfitPct: cfg.takeProfitPct, breakEvenTriggerPct: cfg.breakEvenTriggerPct, enableTrailingStop: cfg.enableTrailingStop, trailingStopPct: cfg.trailingStopPct, holdTimeMinutes: cfg.holdTimeMinutes, stalePositionMinutes: cfg.stalePositionMinutes, staleBandPct: cfg.staleBandPct };
    const netUsd = ((5000 + cfg.priorityFeeLamports) / 1e9) * cfg.solPriceFallbackUsd;
    const rows: Array<{ p: number; i: number; t: number; s: number; fee: number }> = [];
    for (let p = 0; p < series.length; p++) {
      const pre = volumePrefix(series[p]);
      for (let i = 0; i < series[p].length; i++) {
        const snap = snapshotAt(series[p], i, metas[p], pre); if (!snap) continue;
        const t = series[p][i].t + BAR_SEC;
        const c = rankCandidates([snap], cfg, w, t * 1000)[0];
        if (!c.rejected) rows.push({ p, i, t, s: c.composite, fee: expectedFeeBps(c.ageHours, process.env, { chargeOperatorFee: false }) });
      }
    }
    const ts = rows.map((r) => r.t).sort((a, b) => a - b); const split = ts[0] + TRAIN * (ts[ts.length - 1] - ts[0]);
    const q = (xs: number[], f: number) => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(f * (xs.length - 1))] : NaN;
    console.log(`\n== ${set}: ${rows.length} eligible decisions; score p50 ${q(rows.map((r) => r.s), 0.5).toFixed(3)} p90 ${q(rows.map((r) => r.s), 0.9).toFixed(3)} p99 ${q(rows.map((r) => r.s), 0.99).toFixed(3)}`);
    const run = (thr: number, from: number, to: number) => {
      const cands = rows.filter((r) => r.t >= from && r.t < to && r.s >= thr).sort((a, b) => a.t - b.t || b.s - a.s);
      let busyUntil = 0; const tr: TradeResult[] = [];
      for (const r of cands) {
        if (r.t < busyUntil) continue; // 1 open position
        const o = simulateTrade(series[r.p], r.i, metas[r.p], e, [], { feeBps: r.fee, slippageBps: 30, stopSlippageBps: 100, networkUsdPerSide: netUsd }, SIZE, end);
        if (!o || o.censored || o.exitTime > to) continue;
        busyUntil = o.exitTime; tr.push(o);
      }
      const n = tr.length; const hit = n ? tr.filter((x) => x.pnlUsd > 0).length / n : 0; const exp = n ? tr.reduce((s, x) => s + x.pnlPct, 0) / n : 0;
      return { n, hit, exp, perDay: n / days(from, Math.min(to, end)) };
    };
    console.log('thr | train n exp% | TEST n hit exp% trades/day');
    for (const thr of THRS) {
      const a = run(thr, ts[0], split), b = run(thr, split, Infinity);
      console.log(`${thr.toFixed(2)} | ${a.n} ${a.exp.toFixed(2)} | ${b.n} ${(b.hit * 100).toFixed(0)}% ${b.exp.toFixed(2)} ${b.perDay.toFixed(1)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
