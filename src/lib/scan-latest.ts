/**
 * Latest scanner candidate list for the owner "Scanning now" panel.
 * The live worker overwrites logs/scan-latest.json each scan (top 50). Also kept in-memory
 * so the owner snapshot can include it. No secrets, mints shortened.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ScanCandidate } from './signals';
import { peekPumpAge } from './pump-age';

export interface ScanNowRow {
  symbol: string;
  mintShort: string;
  score: number;
  pumpAgeHours: number | null;
  vsAnchor: number | null;
  liquidityUsd: number | null;
  mcapUsd: number | null;
  decision: string;
  reason: string;
}

export interface ScanNow {
  at: string;
  summary: string;
  minScore: number;
  n: number;
  candidates: ScanNowRow[];
}

export const SCAN_LATEST_MAX = 50;

export function scanLatestPath(cwd = process.cwd(), env: Record<string, string | undefined> = process.env): string {
  return env.SCAN_LATEST_PATH || path.join(cwd, 'logs', 'scan-latest.json');
}

export function shortMint(mint: string): string {
  return mint.length > 10 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

export function decideScanRow(
  c: { mint: string; symbol: string; composite: number; rejected?: string; ageHours?: number | null; liquidityUsd?: number | null; marketCap?: number },
  opts: { minScore: number; picked?: Set<string>; outcomes?: Map<string, { decision: string; reason: string }>; nowMs?: number },
): Pick<ScanNowRow, 'decision' | 'reason' | 'pumpAgeHours' | 'vsAnchor'> {
  const ev = peekPumpAge(c.mint, opts.nowMs);
  const pumpAgeHours = ev?.hoursSincePump ?? c.ageHours ?? null;
  const vsAnchor = ev?.vsAnchor ?? null;
  const outcome = opts.outcomes?.get(c.mint);
  if (opts.picked?.has(c.mint) || outcome?.decision === 'picked') {
    return { decision: 'picked', reason: outcome?.reason ?? 'entered', pumpAgeHours, vsAnchor };
  }
  if (outcome) return { decision: outcome.decision, reason: outcome.reason, pumpAgeHours, vsAnchor };
  if (c.rejected) return { decision: 'rejected', reason: c.rejected, pumpAgeHours, vsAnchor };
  if (ev?.block) return { decision: 'too old', reason: ev.reason ?? 'late after pump and below anchor', pumpAgeHours, vsAnchor };
  if (ev?.downWeight) return { decision: 'down-weighted', reason: ev.reason ?? 'late after pump', pumpAgeHours, vsAnchor };
  if (c.composite < opts.minScore) {
    return { decision: `below ${opts.minScore}`, reason: `score ${c.composite.toFixed(3)} < ${opts.minScore.toFixed(3)}`, pumpAgeHours, vsAnchor };
  }
  return { decision: 'qualified', reason: 'above score, not entered this scan', pumpAgeHours, vsAnchor };
}

export function buildScanNow(input: {
  candidates: ScanCandidate[];
  minScore: number;
  summary: string;
  picked?: Set<string>;
  outcomes?: Map<string, { decision: string; reason: string }>;
  at?: string;
  nowMs?: number;
  limit?: number;
}): ScanNow {
  const limit = input.limit ?? SCAN_LATEST_MAX;
  const rows: ScanNowRow[] = input.candidates.slice(0, limit).map((c) => {
    const d = decideScanRow(c, { minScore: input.minScore, picked: input.picked, outcomes: input.outcomes, nowMs: input.nowMs });
    return {
      symbol: c.symbol,
      mintShort: shortMint(c.mint),
      score: Math.round(c.composite * 1000) / 1000,
      pumpAgeHours: d.pumpAgeHours != null && Number.isFinite(d.pumpAgeHours) ? Math.round(d.pumpAgeHours * 10) / 10 : null,
      vsAnchor: d.vsAnchor != null && Number.isFinite(d.vsAnchor) ? Math.round(d.vsAnchor * 100) / 100 : null,
      liquidityUsd: c.liquidityUsd,
      mcapUsd: c.marketCap,
      decision: d.decision,
      reason: d.reason,
    };
  });
  return { at: input.at ?? new Date().toISOString(), summary: input.summary, minScore: input.minScore, n: rows.length, candidates: rows };
}

let last: ScanNow | null = null;

export function lastScanNow(): ScanNow | null { return last; }

export function writeScanLatest(scan: ScanNow, file = scanLatestPath()): ScanNow {
  last = scan;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(scan));
    fs.renameSync(tmp, file);
  } catch { /* panel must never break a scan */ }
  return scan;
}

export function readScanLatest(file = scanLatestPath()): ScanNow | null {
  if (last) return last;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as ScanNow;
    if (j && Array.isArray(j.candidates)) return (last = j);
  } catch { /* missing or unreadable */ }
  return null;
}

export function _resetScanLatest(): void { last = null; }
