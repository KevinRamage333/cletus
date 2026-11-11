/**
 * Box-local store for per-position adaptive exit plans (live owner worker only): the plan chosen at entry
 * (or recomputed for an older open position), the worst drawdown seen while open, and the outcome at close,
 * which feeds the learning loop. A JSON file (EXIT_PLAN_STORE, default logs/exit-plans.json) so no DB
 * migration is needed on the live database; writes are atomic (tmp + rename).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ExitPlan, PastTrade } from './adaptive-exits';

export interface PlanRecord {
  positionId: string; mint: string; symbol: string;
  plan: ExitPlan; source: 'entry' | 'recomputed'; computedAt: string;
  maePct: number;
  outcome?: { mfePct: number; maePct: number; pnlPct: number; reason: string; closedAt: string };
}
type Store = Record<string, PlanRecord>;

const file = () => process.env.EXIT_PLAN_STORE || path.join(process.cwd(), 'logs', 'exit-plans.json');
let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(file(), 'utf8')) as Store; } catch { cache = {}; }
  return cache;
}
function persist() {
  const f = file();
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(load(), null, 1));
    fs.renameSync(`${f}.tmp`, f);
  } catch { /* never block trading on the plan file; the plan stays in memory */ }
}

export function getPlanRecord(positionId: string): PlanRecord | null { return load()[positionId] ?? null; }

export function savePlanRecord(r: PlanRecord): void { load()[r.positionId] = r; persist(); }

/** Track the worst drawdown while open; persisted only when it deepens by >= 1 point (cheap). */
export function noteDrawdown(positionId: string, drawdownPct: number): void {
  const r = load()[positionId];
  if (!r || r.outcome || !(drawdownPct > r.maePct)) return;
  const persistNow = drawdownPct - r.maePct >= 1;
  r.maePct = drawdownPct;
  if (persistNow) persist();
}

export function recordOutcome(positionId: string, o: { mfePct: number; pnlPct: number; reason: string }): void {
  const r = load()[positionId];
  if (!r || r.outcome) return;
  r.outcome = { mfePct: o.mfePct, maePct: r.maePct, pnlPct: o.pnlPct, reason: o.reason, closedAt: new Date().toISOString() };
  persist();
}

/** Closed live trades with a known plan, newest last: the learning loop's input. Book write-offs are excluded. */
export function pastTrades(limit = 200): PastTrade[] {
  return Object.values(load())
    .filter((r) => r.outcome && r.outcome.reason !== 'stuck_written_off' && r.outcome.reason !== 'external_zero')
    .sort((a, b) => (a.outcome!.closedAt < b.outcome!.closedAt ? -1 : 1))
    .slice(-limit)
    .map((r) => ({ mfePct: r.outcome!.mfePct, maePct: r.outcome!.maePct, pnlPct: r.outcome!.pnlPct, stopLossPct: r.plan.stopLossPct, won: r.outcome!.pnlPct > 0 }));
}

/** Test hook. */
export function _resetPlanStoreCache(): void { cache = null; }
