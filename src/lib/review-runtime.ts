/**
 * Live-worker side of the trade journal / daily review. All behind flags that default OFF:
 *   TRADE_JOURNAL=on          write logs/trade-journal.jsonl (engine hooks; logging only)
 *   TRADE_REVIEW_SCHEDULE=on  hourly check (first ~3 min after start/wake): write yesterday's review if it is missing,
 *                             else refresh today's when the last review is >= 20 h old; separate nice'd process
 *   JOURNAL_FEEDBACK=on       a candidate that matches flagged entry-time setups (logs/reviews/flags.json, < 48 h old)
 *                             needs score >= threshold + 0.025 per match, at most +0.05. Never lowers the bar.
 * Nothing here trades, sizes, or moves funds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { activeFlags, feedbackBump, type Flag, type FlagsFile } from './trade-review';

type Log = (level: 'info' | 'warn', msg: string) => unknown;
const on = (k: string) => ['on', 'true', '1'].includes((process.env[k] ?? '').toLowerCase());
export const reviewFlags = () => ({ journal: on('TRADE_JOURNAL'), schedule: on('TRADE_REVIEW_SCHEDULE'), feedback: on('JOURNAL_FEEDBACK') });
const root = () => process.env.CLETUS_ROOT ?? process.cwd();
export const reviewDir = () => process.env.REVIEW_DIR ?? path.join(root(), 'logs', 'reviews');
export const ctDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

let cached: { at: number; flags: Flag[] } | null = null;
export function currentFlags(now = Date.now()): Flag[] {
  if (cached && now - cached.at < 60_000) return cached.flags;
  let f: FlagsFile | null = null;
  try { f = JSON.parse(fs.readFileSync(path.join(reviewDir(), 'flags.json'), 'utf8')) as FlagsFile; } catch { f = null; }
  cached = { at: now, flags: activeFlags(f, now) };
  return cached.flags;
}
export function _resetFlagCache() { cached = null; }

/** Extra score required for this candidate (0 when JOURNAL_FEEDBACK is off or nothing matches). Never throws. */
export function entryFeedback(setup: { signals: Record<string, number>; terms?: Record<string, number> | null; mcapUsd: number | null }, now = new Date()): { bump: number; why: string } {
  if (!on('JOURNAL_FEEDBACK')) return { bump: 0, why: '' };
  try {
    const { bump, matched } = feedbackBump({ ...setup, at: now }, currentFlags(now.getTime()));
    return { bump, why: matched.map((m) => `${m.dim}=${m.value}`).join(', ') };
  } catch { return { bump: 0, why: '' }; }
}

/** Which review (if any) the scheduler should write now. Pure. */
export function reviewDue(now: Date, exists: (day: string) => boolean, lastRunMs: number | null, everyH = 20): string | null {
  const yesterday = ctDay(new Date(now.getTime() - 86_400_000));
  if (!exists(yesterday)) return yesterday;
  if (lastRunMs === null || now.getTime() - lastRunMs >= everyH * 3_600_000) return ctDay(now);
  return null;
}

let running = false;
function runReview(day: string, log: Log) {
  if (running) return;
  running = true;
  const out = fs.openSync(path.join(root(), 'logs', 'review-run.log'), 'a');
  log('info', `daily review: writing ${day} in a low-priority child process`);
  const child = spawn('nice', ['-n', '19', 'npx', 'tsx', '--env-file=.env.local', 'scripts/daily-review.ts', '--day', day], { cwd: root(), stdio: ['ignore', out, out], env: { ...process.env, TRADING_MODE: 'simulation' } });
  child.on('exit', (code) => { running = false; fs.closeSync(out); log(code === 0 ? 'info' : 'warn', `daily review: child finished (exit ${code}); see logs/reviews/${day}.md`); });
  child.on('error', (e) => { running = false; log('warn', `daily review: child failed to start (${e.message})`); });
}

export function startReviewTasks(log: Log): NodeJS.Timeout[] {
  const f = reviewFlags();
  log('info', `journal flags: TRADE_JOURNAL=${f.journal ? 'on' : 'off'} TRADE_REVIEW_SCHEDULE=${f.schedule ? 'on' : 'off'} JOURNAL_FEEDBACK=${f.feedback ? 'on' : 'off'}`);
  if (!f.schedule) return [];
  const check = () => {
    try {
      let last: number | null = null;
      try { last = fs.statSync(path.join(reviewDir(), 'flags.json')).mtimeMs; } catch { /* never */ }
      const day = reviewDue(new Date(), (d) => fs.existsSync(path.join(reviewDir(), `${d}.md`)), last);
      if (day) runReview(day, log);
    } catch (e) { log('warn', `daily review: due check failed (${(e as Error).message})`); }
  };
  return [setTimeout(check, 180_000), setInterval(check, 60 * 60_000)];
}
