/**
 * Daily trade review (pure; scripts/daily-review.ts does the I/O). Groups closed trades by setup — score bucket,
 * signal profile, mcap band, time of day (CT), exit reason — and flags losing setups. Optional bounded feedback
 * (JOURNAL_FEEDBACK=on, default off): a candidate matching flagged ENTRY-time setups needs a higher score,
 * +0.025 per matched flag, capped at +0.05. Exit reason and score bucket are reported but never used as feedback.
 */
export interface ReviewTrade {
  id: string; book: 'live' | 'paper'; lab: string | null; symbol: string; source: 'journal' | 'db';
  openedAt: Date; closedAt: Date; score: number; signals: Record<string, number>; terms: Record<string, number> | null;
  mcapUsd: number | null; exitReason: string; pnlUsd: number; pnlPct: number; holdMin: number;
  mfePct: number | null; maePct: number | null; feesUsd: number | null;
}
export type Dim = 'scoreBucket' | 'signalProfile' | 'mcapBand' | 'timeOfDay' | 'exitReason' | 'book';
export const FEEDBACK_DIMS: Dim[] = ['signalProfile', 'mcapBand', 'timeOfDay'];
export interface GroupStats { dim: Dim; value: string; n: number; wins: number; winRate: number; sumPnlUsd: number; avgPnlPct: number; medHoldMin: number; avgMfePct: number | null; avgMaePct: number | null }
export interface Flag { dim: Dim; value: string; n: number; winRate: number; avgPnlPct: number; sumPnlUsd: number }
/** minGapPp: the setup must also be at least this many points worse than the window's overall average, so a
 * generally bad week doesn't flag every bucket of a dimension (that would just raise the bar everywhere). */
export interface FlagRules { minN: number; maxAvgPnlPct: number; maxWinRate: number; minGapPp: number }
export const DEFAULT_FLAG_RULES: FlagRules = { minN: 5, maxAvgPnlPct: -1, maxWinRate: 0.45, minGapPp: 2 };
export const FEEDBACK_STEP = 0.025;
export const FEEDBACK_MAX = 0.05;

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function scoreBucket(s: number): string {
  if (!fin(s)) return 'unknown';
  if (s < 0.6) return '<0.60';
  if (s < 0.65) return '0.60-0.65';
  if (s < 0.7) return '0.65-0.70';
  if (s < 0.75) return '0.70-0.75';
  return '>=0.75';
}
export function mcapBand(m: number | null | undefined): string {
  if (!fin(m) || m <= 0) return 'unknown';
  if (m < 250_000) return '<$250k';
  if (m < 1_000_000) return '$250k-1M';
  if (m <= 5_000_000) return '$1M-5M';
  return '>$5M';
}
/** Entry hour in America/Chicago -> 4 buckets. */
export function timeOfDay(d: Date): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(d));
  if (h < 6) return 'night 0-6 CT';
  if (h < 12) return 'morning 6-12 CT';
  if (h < 18) return 'afternoon 12-18 CT';
  return 'evening 18-24 CT';
}
/**
 * Signal profile from the 3 liquidity terms that exist for every trade (journal or old DB rows):
 * liquidityBuild, velocitySurge, antiChase (= 1 - momentum). A term counts as "on" at >= 0.5.
 */
export function signalProfile(signals: Record<string, number>, terms?: Record<string, number> | null): string {
  const lb = terms?.liquidityBuild ?? signals.liquidityBuild;
  const vs = terms?.velocitySurge ?? signals.velocitySurge;
  const ac = terms?.antiChase ?? (fin(signals.momentum) ? 1 - Math.min(1, Math.max(0, signals.momentum)) : NaN);
  if (!fin(lb) && !fin(vs) && !fin(ac)) return 'unknown';
  const on = [fin(lb) && lb >= 0.5 ? 'liq' : null, fin(vs) && vs >= 0.5 ? 'vel' : null, fin(ac) && ac >= 0.5 ? 'calm' : 'chase'].filter(Boolean);
  return on.join('+');
}

export function keyOf(t: ReviewTrade, dim: Dim): string {
  switch (dim) {
    case 'scoreBucket': return scoreBucket(t.score);
    case 'signalProfile': return signalProfile(t.signals, t.terms);
    case 'mcapBand': return mcapBand(t.mcapUsd);
    case 'timeOfDay': return timeOfDay(t.openedAt);
    case 'exitReason': return t.exitReason || 'unknown';
    case 'book': return t.lab ? `paper lab ${t.lab.toLowerCase()}` : t.book;
  }
}

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function groupBy(trades: ReviewTrade[], dim: Dim): GroupStats[] {
  const m = new Map<string, ReviewTrade[]>();
  for (const t of trades) { const k = keyOf(t, dim); (m.get(k) ?? m.set(k, []).get(k)!).push(t); }
  return [...m.entries()].map(([value, ts]) => {
    const wins = ts.filter((t) => t.pnlUsd > 0).length;
    const mfe = mean(ts.map((t) => t.mfePct).filter(fin)); const mae = mean(ts.map((t) => t.maePct).filter(fin));
    return {
      dim, value, n: ts.length, wins, winRate: r2(wins / ts.length), sumPnlUsd: r2(ts.reduce((a, t) => a + t.pnlUsd, 0)),
      avgPnlPct: r2(ts.reduce((a, t) => a + t.pnlPct, 0) / ts.length), medHoldMin: r2(median(ts.map((t) => t.holdMin))),
      avgMfePct: mfe === null ? null : r2(mfe), avgMaePct: mae === null ? null : r2(mae),
    };
  }).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
}

export function flagLosers(groups: GroupStats[], rules: FlagRules = DEFAULT_FLAG_RULES, baselineAvgPct?: number): Flag[] {
  return groups
    .filter((g) => g.value !== 'unknown' && g.n >= rules.minN && g.avgPnlPct <= rules.maxAvgPnlPct && g.sumPnlUsd < 0 && g.winRate <= rules.maxWinRate
      && (baselineAvgPct === undefined || g.avgPnlPct <= baselineAvgPct - rules.minGapPp))
    .map((g) => ({ dim: g.dim, value: g.value, n: g.n, winRate: g.winRate, avgPnlPct: g.avgPnlPct, sumPnlUsd: g.sumPnlUsd }));
}

export interface FlagsFile { generatedAt: string; windowDays: number; rules: FlagRules; flags: Flag[] }

/** Score-bar bump for a candidate: +FEEDBACK_STEP per matched entry-time flag, capped at FEEDBACK_MAX. */
export function feedbackBump(setup: { signals: Record<string, number>; terms?: Record<string, number> | null; mcapUsd: number | null; at: Date }, flags: Flag[]): { bump: number; matched: Flag[] } {
  const keys: Record<string, string> = { signalProfile: signalProfile(setup.signals, setup.terms), mcapBand: mcapBand(setup.mcapUsd), timeOfDay: timeOfDay(setup.at) };
  const matched = flags.filter((f) => FEEDBACK_DIMS.includes(f.dim) && keys[f.dim] === f.value);
  return { bump: Math.min(FEEDBACK_MAX, Math.round(matched.length * FEEDBACK_STEP * 1000) / 1000), matched };
}

/** Flags older than maxAgeH are ignored, so a stale review can never keep throttling. */
export function activeFlags(f: FlagsFile | null, now = Date.now(), maxAgeH = 48): Flag[] {
  if (!f || !Array.isArray(f.flags)) return [];
  const t = Date.parse(f.generatedAt);
  if (!fin(t) || now - t > maxAgeH * 3_600_000 || t > now + 3_600_000) return [];
  return f.flags.filter((x) => x && FEEDBACK_DIMS.includes(x.dim) && typeof x.value === 'string');
}

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
const pct = (n: number | null) => (n === null ? '–' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);
function table(gs: GroupStats[]): string {
  const rows = gs.map((g) => `| ${g.value} | ${g.n} | ${Math.round(g.winRate * 100)}% | ${pct(g.avgPnlPct)} | ${usd(g.sumPnlUsd)} | ${g.medHoldMin.toFixed(0)}m | ${pct(g.avgMfePct)} / ${g.avgMaePct === null ? '–' : `-${g.avgMaePct.toFixed(1)}%`} |`);
  return ['| setup | n | win | avg P&L | total | med hold | avg MFE / MAE |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
}
export const REVIEW_DIMS: Dim[] = ['book', 'scoreBucket', 'signalProfile', 'mcapBand', 'timeOfDay', 'exitReason'];
const DIM_TITLE: Record<Dim, string> = { book: 'Book', scoreBucket: 'Score bucket', signalProfile: 'Signal profile (liq / vel / calm|chase)', mcapBand: 'Market cap at entry', timeOfDay: 'Entry time of day', exitReason: 'Exit reason' };

export function buildReport(day: string, dayTrades: ReviewTrade[], windowTrades: ReviewTrade[], windowDays: number, flags: Flag[], notes: string[] = []): string {
  const live = dayTrades.filter((t) => t.book === 'live');
  const sum = (ts: ReviewTrade[]) => ts.reduce((a, t) => a + t.pnlUsd, 0);
  const wr = (ts: ReviewTrade[]) => (ts.length ? `${Math.round((ts.filter((t) => t.pnlUsd > 0).length / ts.length) * 100)}%` : '–');
  const out: string[] = [];
  out.push(`# Cletus daily review — ${day} (CT)`, '');
  out.push(`- **Live today:** ${live.length} closed, win rate ${wr(live)}, P&L ${usd(sum(live))}.`);
  for (const t of live) out.push(`  - ${t.symbol}: ${usd(t.pnlUsd)} (${pct(t.pnlPct)}) via ${t.exitReason}, score ${t.score.toFixed(3)}, held ${t.holdMin.toFixed(0)}m, MFE ${pct(t.mfePct)} / MAE ${t.maePct === null ? '–' : `-${t.maePct.toFixed(1)}%`}`);
  const paper = dayTrades.filter((t) => t.book === 'paper');
  out.push(`- **Paper today:** ${paper.length} closed, win rate ${wr(paper)}, P&L ${usd(sum(paper))}.`);
  out.push(`- **Rolling ${windowDays}d (live + paper):** ${windowTrades.length} closed, win rate ${wr(windowTrades)}, avg P&L ${pct(windowTrades.length ? windowTrades.reduce((a, t) => a + t.pnlPct, 0) / windowTrades.length : null)}.`, '');
  out.push('## Flagged losing setups', '');
  out.push(`Rule: n >= ${DEFAULT_FLAG_RULES.minN}, avg P&L <= ${DEFAULT_FLAG_RULES.maxAvgPnlPct}%, win rate <= ${DEFAULT_FLAG_RULES.maxWinRate * 100}%, net loss, and >= ${DEFAULT_FLAG_RULES.minGapPp} points worse than the window average.`, '');
  if (!flags.length) out.push('None.');
  for (const f of flags) out.push(`- **${DIM_TITLE[f.dim]}: ${f.value}** — ${f.n} trades, ${Math.round(f.winRate * 100)}% wins, avg ${pct(f.avgPnlPct)}, total ${usd(f.sumPnlUsd)}${FEEDBACK_DIMS.includes(f.dim) ? '' : ' (report only, not used for feedback)'}`);
  out.push('');
  for (const d of REVIEW_DIMS) out.push(`## ${DIM_TITLE[d]} (rolling ${windowDays}d)`, '', table(groupBy(windowTrades, d)), '');
  if (notes.length) out.push('## Notes', '', ...notes.map((n) => `- ${n}`), '');
  return out.join('\n');
}
