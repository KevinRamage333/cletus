/**
 * Daily trade review. Read-only on the DBs; writes logs/reviews/YYYY-MM-DD.md and logs/reviews/flags.json.
 *   npx tsx --env-file=.env.local scripts/daily-review.ts                 # today (CT), rolling 7 days
 *   npx tsx --env-file=.env.local scripts/daily-review.ts --day 2026-11-10 --days 7
 * Sources: logs/trade-journal.jsonl (full why/what, TRADE_JOURNAL=on) first; closed Positions in the app DB fill in
 * trades the journal doesn't have (backfill: mcap rebuilt from market_data price history, MFE/MAE from
 * logs/exit-plans.json for live trades). Never trades, never prints secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { readJournalTrades } from '../src/lib/trade-journal';
import { buildReport, flagLosers, groupBy, FEEDBACK_DIMS, REVIEW_DIMS, DEFAULT_FLAG_RULES, type ReviewTrade, type FlagsFile } from '../src/lib/trade-review';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const ROOT = process.env.CLETUS_ROOT ?? process.cwd();
const ctDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const DAY = arg('--day') ?? ctDay(new Date());
const DAYS = Math.max(1, Math.min(60, Number(arg('--days') ?? 7) || 7));
if (!/^\d{4}-\d{2}-\d{2}$/.test(DAY)) { console.error('bad --day'); process.exit(2); }
// Same client setup as scripts/retrain-weights.ts (local Postgres with a self-signed cert).
const pgc = (url: string) => { const u = new URL(url); u.searchParams.delete('sslmode'); u.searchParams.delete('schema'); return new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } }); };
const OUT_DIR = process.env.REVIEW_DIR ?? path.join(ROOT, 'logs', 'reviews');

async function main() {
  const notes: string[] = [];
  const byId = new Map<string, ReviewTrade>();
  // 1. Journal
  for (const { entry: e, exit: x } of readJournalTrades()) {
    if (!x) continue;
    byId.set(e.positionId, {
      id: e.positionId, book: e.book, lab: e.labPreset, symbol: e.symbol, source: 'journal', openedAt: new Date(e.at), closedAt: new Date(x.at),
      score: e.score, signals: e.signals, terms: e.terms, mcapUsd: e.mcapUsd, exitReason: x.reason, pnlUsd: x.pnlUsd, pnlPct: x.pnlPct,
      holdMin: x.holdMin, mfePct: x.mfePct, maePct: x.maePct, feesUsd: x.feesUsd,
    });
  }
  const journaled = byId.size;
  // 2. App DB backfill
  const since = new Date(Date.parse(`${DAY}T23:59:59-06:00`) - DAYS * 86_400_000);
  let backfilled = 0;
  const plans: Record<string, { outcome?: { mfePct: number; maePct: number } }> = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'logs', 'exit-plans.json'), 'utf8')); } catch { return {}; } })();
  const need: ReviewTrade[] = [];
  if (process.env.DATABASE_URL) {
    const app = pgc(process.env.DATABASE_URL);
    try {
      await app.connect(); await app.query('set search_path=app');
      const rows = (await app.query(`select p.id, p.symbol, p.mint, p.simulated, p."openedAt", p."closedAt", p."compositeScore", p.signals, p."exitReason", p."pnlUsd", p."pnlPct", p."feesUsd", p."highestPrice", p."entryPrice", a."labPreset"
        from "Position" p join "Account" a on a.id = p."accountId" where p.status = 'closed' and p."pnlPct" is not null and p."closedAt" >= $1`, [since])).rows;
      for (const r of rows) {
        if (byId.has(r.id)) continue;
        let signals: Record<string, number> = {}; try { signals = JSON.parse(r.signals); } catch { /* */ }
        const o = plans[r.id]?.outcome;
        const t: ReviewTrade & { mint?: string; entryPrice?: number } = {
          id: r.id, book: r.simulated ? 'paper' : 'live', lab: r.labPreset ?? null, symbol: r.symbol, source: 'db', openedAt: new Date(r.openedAt), closedAt: new Date(r.closedAt),
          score: Number(r.compositeScore), signals, terms: null, mcapUsd: null, exitReason: r.exitReason ?? 'unknown', pnlUsd: Number(r.pnlUsd ?? 0), pnlPct: Number(r.pnlPct ?? 0),
          holdMin: (new Date(r.closedAt).getTime() - new Date(r.openedAt).getTime()) / 60000,
          mfePct: o ? o.mfePct : r.entryPrice > 0 ? Math.max(0, (r.highestPrice / r.entryPrice - 1) * 100) : null, maePct: o ? o.maePct : null, feesUsd: Number(r.feesUsd ?? 0),
          mint: r.mint, entryPrice: Number(r.entryPrice),
        };
        byId.set(r.id, t); need.push(t); backfilled++;
      }
    } catch (e) { notes.push(`app DB unavailable (${(e as Error).message.slice(0, 80)}); journal only`); }
    finally { await app.end().catch(() => undefined); }
  } else notes.push('DATABASE_URL not set; journal only');
  // 3. Backfill mcap at entry: latest snapshot mcap scaled by (5m close at entry / snapshot price).
  if (need.length && process.env.MARKET_DATA_DATABASE_URL) {
    const md = pgc(process.env.MARKET_DATA_DATABASE_URL);
    try {
      await md.connect();
      const q = need.map((t) => [(t as { mint?: string }).mint ?? '', t.openedAt.toISOString()]);
      const rows = (await md.query(`with q as (select * from unnest($1::text[], $2::timestamptz[]) as q(mint, at))
        select q.mint, q.at, s.mcap_usd, s.price_usd, b.close from q
        join lateral (select p.address from market_data.pools p where p.base_mint = q.mint order by (select max(reserve_usd) from market_data.pool_snapshots x where x.pool = p.address) desc nulls last limit 1) p on true
        join lateral (select mcap_usd, price_usd from market_data.pool_snapshots s where s.pool = p.address and coalesce(s.mcap_usd, 0) > 0 order by abs(extract(epoch from s.taken_at - q.at)) limit 1) s on true
        left join lateral (select close from market_data.ohlcv_5m b where b.pool = p.address and b.bucket between q.at - interval '10 minutes' and q.at + interval '5 minutes' order by abs(extract(epoch from b.bucket - q.at)) limit 1) b on true`,
        [q.map((x) => x[0]), q.map((x) => x[1])])).rows;
      const key = (m: string, at: string) => `${m}|${new Date(at).toISOString()}`;
      const mc = new Map<string, number>();
      for (const r of rows) { const m = Number(r.mcap_usd), p = Number(r.price_usd), c = Number(r.close); mc.set(key(r.mint, r.at), c > 0 && p > 0 ? m * (c / p) : m); }
      let hit = 0;
      for (const t of need) { const v = mc.get(key((t as { mint?: string }).mint ?? '', t.openedAt.toISOString())); if (v && Number.isFinite(v)) { t.mcapUsd = v; hit++; } }
      notes.push(`mcap at entry rebuilt from market_data for ${hit}/${need.length} DB-backfilled trades`);
    } catch (e) { notes.push(`market_data unavailable for mcap backfill (${(e as Error).message.slice(0, 80)})`); }
    finally { await md.end().catch(() => undefined); }
  }
  const all = [...byId.values()].filter((t) => t.closedAt >= since);
  const dayTrades = all.filter((t) => ctDay(t.closedAt) === DAY);
  notes.push(`${journaled} trades from the journal, ${backfilled} backfilled from the DB (no 6-term inputs, volatility or regime for those).`);
  notes.push('Feedback (JOURNAL_FEEDBACK=on, default off) uses only entry-time flags (signal profile, mcap band, time of day): +0.025 score bar per match, max +0.05, ignored when flags are > 48h old.');
  const baseline = all.length ? all.reduce((a, t) => a + t.pnlPct, 0) / all.length : 0;
  const flags = REVIEW_DIMS.flatMap((d) => flagLosers(groupBy(all, d), DEFAULT_FLAG_RULES, baseline));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = buildReport(DAY, dayTrades, all, DAYS, flags, notes);
  const file = path.join(OUT_DIR, `${DAY}.md`);
  fs.writeFileSync(file, report);
  const ff: FlagsFile = { generatedAt: new Date().toISOString(), windowDays: DAYS, rules: DEFAULT_FLAG_RULES, flags: flags.filter((f) => FEEDBACK_DIMS.includes(f.dim)) };
  fs.writeFileSync(path.join(OUT_DIR, 'flags.json.tmp'), JSON.stringify(ff, null, 1));
  fs.renameSync(path.join(OUT_DIR, 'flags.json.tmp'), path.join(OUT_DIR, 'flags.json'));
  console.log(`review ${DAY}: ${dayTrades.length} closed today, ${all.length} in ${DAYS}d window, ${flags.length} losing setup(s) flagged -> ${path.relative(ROOT, file)}`);
}
main().catch((e) => { console.error('daily review failed:', (e as Error).message); process.exit(1); });
