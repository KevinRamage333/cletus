import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scoreBucket, mcapBand, timeOfDay, signalProfile, groupBy, flagLosers, feedbackBump, activeFlags, buildReport, DEFAULT_FLAG_RULES, FEEDBACK_MAX, type ReviewTrade, type Flag } from '@/lib/trade-review';
import { entryFeedback, reviewDue, _resetFlagCache } from '@/lib/review-runtime';

const t = (o: Partial<ReviewTrade>): ReviewTrade => ({ id: Math.random().toString(36), book: 'live', lab: null, symbol: 'X', source: 'journal', openedAt: new Date('2026-11-11T20:00:00Z'), closedAt: new Date('2026-11-11T21:00:00Z'), score: 0.62, signals: { liquidityBuild: 0.8, velocitySurge: 0.2, momentum: 0.1 }, terms: null, mcapUsd: 300000, exitReason: 'stop_loss', pnlUsd: -1, pnlPct: -15, holdMin: 30, mfePct: 1, maePct: 15, feesUsd: 0.02, ...o });

describe('setup keys', () => {
  it('buckets', () => {
    expect(scoreBucket(0.62)).toBe('0.60-0.65'); expect(scoreBucket(0.8)).toBe('>=0.75');
    expect(mcapBand(100000)).toBe('<$250k'); expect(mcapBand(null)).toBe('unknown'); expect(mcapBand(6e6)).toBe('>$5M');
    expect(timeOfDay(new Date('2026-11-11T20:00:00Z'))).toBe('afternoon 12-18 CT'); // 2 PM CT
    expect(timeOfDay(new Date('2026-11-12T03:00:00Z'))).toBe('evening 18-24 CT'); // 9 PM CT
  });
  it('signal profile from 3 rebuildable terms (journal terms take precedence)', () => {
    expect(signalProfile({ liquidityBuild: 0.8, velocitySurge: 0.2, momentum: 0.1 })).toBe('liq+calm');
    expect(signalProfile({ liquidityBuild: 0.1, velocitySurge: 0.9, momentum: 0.9 })).toBe('vel+chase');
    expect(signalProfile({}, { liquidityBuild: 0.9, velocitySurge: 0.9, antiChase: 0.9 })).toBe('liq+vel+calm');
    expect(signalProfile({})).toBe('unknown');
  });
});

describe('grouping and flags', () => {
  const losers = Array.from({ length: 6 }, () => t({ mcapUsd: 100000, pnlPct: -15, pnlUsd: -1 }));
  const winners = Array.from({ length: 6 }, () => t({ mcapUsd: 2e6, pnlPct: 10, pnlUsd: 0.6, exitReason: 'take_profit' }));
  const all = [...losers, ...winners];
  const base = all.reduce((a, x) => a + x.pnlPct, 0) / all.length;
  it('groups with stats', () => {
    const g = groupBy(all, 'mcapBand');
    const lo = g.find((x) => x.value === '<$250k')!;
    expect(lo).toMatchObject({ n: 6, wins: 0, winRate: 0, avgPnlPct: -15, sumPnlUsd: -6 });
  });
  it('flags only clearly losing setups worse than the window average, with enough trades', () => {
    const f = flagLosers(groupBy(all, 'mcapBand'), DEFAULT_FLAG_RULES, base);
    expect(f.map((x) => x.value)).toEqual(['<$250k']);
    expect(flagLosers(groupBy(losers.slice(0, 4), 'mcapBand'))).toEqual([]); // n < 5
    // Every bucket equally bad -> none is worse than the average -> no flags.
    expect(flagLosers(groupBy(losers, 'mcapBand'), DEFAULT_FLAG_RULES, -15)).toEqual([]);
  });
  it('report has the key sections', () => {
    const md = buildReport('2026-11-11', all, all, 7, flagLosers(groupBy(all, 'mcapBand'), DEFAULT_FLAG_RULES, base));
    expect(md).toMatch(/# Cletus daily review — 2026-11-11/);
    expect(md).toMatch(/Flagged losing setups/);
    expect(md).toMatch(/Market cap at entry: <\$250k/);
    expect(md).toMatch(/## Exit reason/);
  });
});

describe('bounded feedback', () => {
  const flags: Flag[] = [
    { dim: 'mcapBand', value: '<$250k', n: 6, winRate: 0, avgPnlPct: -15, sumPnlUsd: -6 },
    { dim: 'signalProfile', value: 'liq+calm', n: 6, winRate: 0, avgPnlPct: -15, sumPnlUsd: -6 },
    { dim: 'timeOfDay', value: 'afternoon 12-18 CT', n: 6, winRate: 0, avgPnlPct: -15, sumPnlUsd: -6 },
    { dim: 'exitReason', value: 'stop_loss', n: 6, winRate: 0, avgPnlPct: -15, sumPnlUsd: -6 },
    { dim: 'scoreBucket', value: '0.60-0.65', n: 6, winRate: 0, avgPnlPct: -15, sumPnlUsd: -6 },
  ];
  const setup = { signals: { liquidityBuild: 0.8, velocitySurge: 0.2, momentum: 0.1 }, mcapUsd: 100000, at: new Date('2026-11-11T20:00:00Z') };
  it('+0.025 per entry-time match, capped at +0.05; exit reason / score bucket never count', () => {
    expect(feedbackBump(setup, flags.slice(0, 1)).bump).toBe(0.025);
    const all = feedbackBump(setup, flags);
    expect(all.matched).toHaveLength(3);
    expect(all.bump).toBe(FEEDBACK_MAX);
    expect(feedbackBump(setup, flags.slice(3)).bump).toBe(0);
    expect(feedbackBump({ ...setup, mcapUsd: 2e6 }, flags.slice(0, 1)).bump).toBe(0);
  });
  it('stale or future flag files are ignored', () => {
    const now = Date.parse('2026-11-11T20:00:00Z');
    expect(activeFlags({ generatedAt: '2026-11-11T10:00:00Z', windowDays: 7, rules: DEFAULT_FLAG_RULES, flags }, now)).toHaveLength(3);
    expect(activeFlags({ generatedAt: '2026-11-08T10:00:00Z', windowDays: 7, rules: DEFAULT_FLAG_RULES, flags }, now)).toEqual([]);
    expect(activeFlags({ generatedAt: '2026-11-13T10:00:00Z', windowDays: 7, rules: DEFAULT_FLAG_RULES, flags }, now)).toEqual([]);
    expect(activeFlags(null, now)).toEqual([]);
  });

  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-')); process.env.REVIEW_DIR = dir; _resetFlagCache(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.REVIEW_DIR; delete process.env.JOURNAL_FEEDBACK; _resetFlagCache(); });
  it('entryFeedback is 0 with the flag off, bounded with it on, and survives a corrupt file', () => {
    const now = new Date('2026-11-11T20:00:00Z');
    fs.writeFileSync(path.join(dir, 'flags.json'), JSON.stringify({ generatedAt: '2026-11-11T19:00:00Z', windowDays: 7, rules: DEFAULT_FLAG_RULES, flags }));
    expect(entryFeedback(setup, now).bump).toBe(0);
    process.env.JOURNAL_FEEDBACK = 'on'; _resetFlagCache();
    expect(entryFeedback(setup, now).bump).toBe(0.05);
    fs.writeFileSync(path.join(dir, 'flags.json'), '{corrupt'); _resetFlagCache();
    expect(entryFeedback(setup, now).bump).toBe(0);
  });
  it('scheduler: yesterday first, then refresh after 20h', () => {
    const now = new Date('2026-11-11T20:00:00Z');
    expect(reviewDue(now, () => false, null)).toBe('2026-11-10');
    expect(reviewDue(now, () => true, null)).toBe('2026-11-11');
    expect(reviewDue(now, () => true, now.getTime() - 3_600_000)).toBeNull();
    expect(reviewDue(now, () => true, now.getTime() - 21 * 3_600_000)).toBe('2026-11-11');
  });
});
