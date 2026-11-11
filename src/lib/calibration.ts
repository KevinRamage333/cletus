/**
 * Honest confidence for the Brain: what the backtest says trades with a given composite score actually did.
 * Data: src/lib/backtest/calibration.json, written by `scripts/backtest/run.ts --write-calibration` (walk-forward,
 * net of fees/impact/slippage). If the score did not beat the base rate out of sample (`scorePredictive: false`),
 * we report the preset's base rate, not a per-score number, so Cletus never claims precision it does not have.
 */
import table from './backtest/calibration.json';
import type { McapPreset } from './config';

interface BucketRow { lo: number; hi: number; n: number; winRate: number | null; meanRetPct: number | null; wilsonLo: number | null; wilsonHi: number | null }
interface PresetCal { n: number; pools: number; baseWinRate: number | null; baseCi: [number, number] | null; meanNetPct: number | null; scorePredictive: boolean; testIcLive: number | null; buckets: BucketRow[]; exits: string; threshold: number }
interface CalTable { generatedAt?: string; datasetHash?: string; range?: { start: string; end: string }; pools?: number; method?: string; clips: Record<string, Partial<Record<McapPreset, PresetCal>>> }

export interface ScoreConfidence {
  preset: McapPreset; clipUsd: number; winProbability: number | null; ci95: [number, number] | null; expectedNetPct: number | null; sampleSize: number;
  basis: 'score_bucket' | 'preset_base_rate'; scorePredictive: boolean; note: string; dataRange: string | null;
}

const T = table as unknown as CalTable;
const MIN_BUCKET_N = 30;

/** Pick the calibration clip closest to the trade size (impact makes $500 clips cost more than $25 clips). */
function clipFor(sizeUsd: number | undefined, t: CalTable = T): string | null {
  const clips = Object.keys(t.clips ?? {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clips.length) return null;
  const s = sizeUsd ?? 500;
  return String(clips.reduce((best, c) => (Math.abs(Math.log(c / s)) < Math.abs(Math.log(best / s)) ? c : best), clips[0]));
}

export function scoreConfidence(score: number, preset: McapPreset, sizeUsd?: number, t: CalTable = T): ScoreConfidence | null {
  const clip = clipFor(sizeUsd, t); if (!clip) return null;
  const p = t.clips[clip]?.[preset]; if (!p) return null;
  const range = t.range ? `${t.range.start.slice(0, 10)} to ${t.range.end.slice(0, 10)}` : null;
  const bucket = p.buckets.find((b) => score >= b.lo && score <= b.hi);
  const useBucket = p.scorePredictive && bucket && bucket.n >= MIN_BUCKET_N && bucket.winRate !== null;
  const win = useBucket ? bucket!.winRate : p.baseWinRate;
  const ci = useBucket ? ([bucket!.wilsonLo ?? 0, bucket!.wilsonHi ?? 1] as [number, number]) : p.baseCi;
  const exp = useBucket ? bucket!.meanRetPct : p.meanNetPct;
  const note = p.scorePredictive
    ? 'Historical backtest estimate; past results do not predict future results.'
    : 'In out-of-sample testing the composite score did not predict outcomes better than the average, so this is the average for all trades in this market-cap band, not a score-specific estimate. Past results do not predict future results.';
  return { preset, clipUsd: Number(clip), winProbability: win, ci95: ci, expectedNetPct: exp, sampleSize: useBucket ? bucket!.n : p.n, basis: useBucket ? 'score_bucket' : 'preset_base_rate', scorePredictive: p.scorePredictive, note, dataRange: range };
}

/** Compact summary for the Brain's get_backtest tool. */
export function backtestSummary(t: CalTable = T) {
  return { generatedAt: t.generatedAt ?? null, dataRange: t.range ?? null, pools: t.pools ?? null, method: t.method ?? null, clips: t.clips };
}
