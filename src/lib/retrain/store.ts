/**
 * Versioned weight-set registry for the nightly retrain (file based, box only; never deployed).
 *   data/weight-sets/registry.json  versions + activeId + previousId + lastRun (atomic tmp+rename writes)
 *   logs/retrain.jsonl              one JSON line per decision (run, promote, reject, rollback, load)
 * Version "default" is always present and equals the hand-built LIQUIDITY_WEIGHTS + MIN_COMPOSITE_SCORE.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_WEIGHTS, normalise, TERMS, type TermWeights } from './core';

export interface WeightSetVersion {
  id: string; createdAt: string; source: 'default' | 'retrain' | 'manual';
  weights: TermWeights; threshold: number; parentId: string | null;
  metrics?: unknown; note?: string;
}
export interface Registry {
  versions: WeightSetVersion[]; activeId: string; previousId: string | null;
  lastRunAt: string | null; lastRunResult: string | null;
}

const root = () => process.env.CLETUS_ROOT ?? process.cwd();
export const registryPath = () => process.env.RETRAIN_REGISTRY_PATH ?? path.join(root(), 'data', 'weight-sets', 'registry.json');
export const decisionLogPath = () => process.env.RETRAIN_LOG_PATH ?? path.join(root(), 'logs', 'retrain.jsonl');

export function defaultVersion(threshold: number): WeightSetVersion {
  return { id: 'default', createdAt: new Date(0).toISOString(), source: 'default', weights: { ...DEFAULT_WEIGHTS }, threshold, parentId: null, note: 'hand-built liquidity set (src/lib/signals.ts)' };
}

export function validVersion(v: unknown): v is WeightSetVersion {
  const x = v as WeightSetVersion;
  if (!x || typeof x.id !== 'string' || !x.weights || !Number.isFinite(x.threshold)) return false;
  if (!TERMS.every((k) => Number.isFinite(x.weights[k]) && x.weights[k] >= 0)) return false;
  const s = TERMS.reduce((a, k) => a + x.weights[k], 0);
  return Math.abs(s - 1) < 1e-3 && x.threshold >= 0.3 && x.threshold <= 0.95;
}

export function readRegistry(defaultThreshold: number): Registry {
  let reg: Registry | null = null;
  try { reg = JSON.parse(fs.readFileSync(registryPath(), 'utf8')) as Registry; } catch { /* missing or corrupt -> default */ }
  if (!reg || !Array.isArray(reg.versions)) reg = { versions: [], activeId: 'default', previousId: null, lastRunAt: null, lastRunResult: null };
  reg.versions = reg.versions.filter(validVersion);
  if (!reg.versions.some((v) => v.id === 'default')) reg.versions.unshift(defaultVersion(defaultThreshold));
  if (!reg.versions.some((v) => v.id === reg!.activeId)) reg.activeId = 'default';
  return reg;
}

export function writeRegistry(reg: Registry): void {
  const p = registryPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2));
  fs.renameSync(tmp, p);
}

export function logDecision(event: string, data: Record<string, unknown>): void {
  try {
    const p = decisionLogPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify({ at: new Date().toISOString(), event, ...data }) + '\n');
  } catch { /* logging must never break trading */ }
}

export function activeVersion(reg: Registry): WeightSetVersion {
  return reg.versions.find((v) => v.id === reg.activeId) ?? reg.versions.find((v) => v.id === 'default')!;
}

export function newVersionId(now = new Date()): string {
  return `ws-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
}

/** Add a version and make it active; the old active becomes `previousId` (instant rollback target). Keeps the last 30. */
export function promote(reg: Registry, v: Omit<WeightSetVersion, 'weights'> & { weights: TermWeights }): Registry {
  const ver = { ...v, weights: normalise(v.weights, 0) };
  const versions = [...reg.versions.filter((x) => x.id !== ver.id), ver];
  const keep = new Set(['default', reg.activeId, ver.id]);
  const trimmed = versions.filter((x, i) => keep.has(x.id) || i >= versions.length - 30);
  return { ...reg, versions: trimmed, previousId: reg.activeId, activeId: ver.id };
}

/** Roll back to 'previous' (default), 'default', or a specific version id. Returns null if the target is unknown. */
export function rollback(reg: Registry, target: string = 'previous'): Registry | null {
  const id = target === 'previous' ? (reg.previousId ?? 'default') : target;
  if (!reg.versions.some((v) => v.id === id)) return null;
  if (id === reg.activeId) return reg;
  return { ...reg, previousId: reg.activeId, activeId: id };
}

/** Catch-up scheduling: due when never run or the last run is older than `everyHours` (default 20 h, so one per night even if the box slept). */
export function isDue(reg: Pick<Registry, 'lastRunAt'>, now = Date.now(), everyHours = 20): boolean {
  if (!reg.lastRunAt) return true;
  const t = Date.parse(reg.lastRunAt);
  return !Number.isFinite(t) || now - t >= everyHours * 3_600_000;
}
