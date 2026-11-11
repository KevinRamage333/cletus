/**
 * Live-worker side of the nightly retrain. All behaviour is behind flags that default OFF:
 *   RETRAINED_WEIGHTS=on   load the registry's active weight set + threshold at startup (else hand-built set + env threshold)
 *   WEIGHTS_HOT_RELOAD=on  also re-apply when registry.json changes (promotion or rollback) without a restart
 *   RETRAIN_SCHEDULE=on    hourly due-check (and once shortly after start/wake): if the last run is >= RETRAIN_EVERY_HOURS
 *                          (default 20) old, run scripts/retrain-weights.ts --apply in a separate low-priority process,
 *                          so the replay never blocks scans or stop checks. A sleeping box simply runs it on wake.
 * Nothing here trades, moves funds, or touches the database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildConfig, setMinCompositeScoreOverride } from '../config';
import { setLiquidityWeights } from '../signals';
import { activeVersion, isDue, logDecision, readRegistry, registryPath, type WeightSetVersion } from './store';

type Log = (level: 'info' | 'warn', msg: string) => unknown;
const on = (k: string) => (process.env[k] ?? '').toLowerCase() === 'on' || process.env[k] === 'true';
export const retrainFlags = () => ({ load: on('RETRAINED_WEIGHTS'), hotReload: on('WEIGHTS_HOT_RELOAD'), schedule: on('RETRAIN_SCHEDULE') });
const baseThreshold = () => buildConfig(process.env).minCompositeScore;
const fmt = (v: WeightSetVersion) => `${v.id} thr ${v.threshold.toFixed(3)} [${Object.entries(v.weights).map(([k, w]) => `${k} ${w.toFixed(3)}`).join(', ')}]`;

let appliedId: string | null = null;

/** Apply the registry's active set (or clear overrides for "default"). Returns the version applied. */
export function applyActiveWeightSet(log: Log): WeightSetVersion {
  const v = activeVersion(readRegistry(baseThreshold()));
  if (v.id === 'default') { setLiquidityWeights(null); setMinCompositeScoreOverride(null); }
  else { setLiquidityWeights(v.weights); setMinCompositeScoreOverride(v.threshold); }
  if (appliedId !== v.id) {
    log('info', `retrained weights: active set ${fmt(v.id === 'default' ? { ...v, threshold: baseThreshold() } : v)}`);
    logDecision('load', { id: v.id, threshold: v.threshold, weights: v.weights, pid: process.pid });
  }
  appliedId = v.id;
  return v;
}

let running = false;
function runRetrainChild(log: Log): void {
  if (running) return;
  running = true;
  const root = process.env.CLETUS_ROOT ?? process.cwd();
  const out = fs.openSync(path.join(root, 'logs', 'retrain-run.log'), 'a');
  const args = ['-n', '19', 'npx', 'tsx', '--env-file=.env.local', 'scripts/retrain-weights.ts', '--apply', '--if-due'];
  log('info', 'retrain: nightly run is due; starting scripts/retrain-weights.ts --apply in a low-priority child process');
  const child = spawn('nice', args, { cwd: root, stdio: ['ignore', out, out], env: { ...process.env, TRADING_MODE: 'simulation' } });
  child.on('exit', (code) => { running = false; fs.closeSync(out); log(code === 0 ? 'info' : 'warn', `retrain: child finished (exit ${code}); see logs/retrain.jsonl`); });
  child.on('error', (e) => { running = false; log('warn', `retrain: child failed to start (${e.message})`); });
}

/** Start the optional hot-reload watcher and catch-up scheduler. Returns timers so the engine can clear them. */
export function startRetrainTasks(log: Log): NodeJS.Timeout[] {
  const f = retrainFlags();
  const timers: NodeJS.Timeout[] = [];
  if (f.load && f.hotReload) {
    let last = 0;
    try { last = fs.statSync(registryPath()).mtimeMs; } catch { /* none yet */ }
    timers.push(setInterval(() => {
      let m = 0; try { m = fs.statSync(registryPath()).mtimeMs; } catch { return; }
      if (m === last) return;
      last = m;
      try { applyActiveWeightSet(log); } catch (e) { log('warn', `retrained weights: hot reload failed (${(e as Error).message}); keeping the current set`); }
    }, 60_000));
  }
  if (f.schedule) {
    const everyH = Number(process.env.RETRAIN_EVERY_HOURS ?? 20) || 20;
    const check = () => { try { if (isDue(readRegistry(baseThreshold()), Date.now(), everyH)) runRetrainChild(log); } catch (e) { log('warn', `retrain: due check failed (${(e as Error).message})`); } };
    timers.push(setTimeout(check, 120_000));
    timers.push(setInterval(check, 60 * 60_000));
  }
  return timers;
}
