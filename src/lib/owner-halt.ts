/**
 * Durable owner sell-all / kill-switch flag.
 * Pure merge + apply helpers are unit-tested; IO lives in owner-sync and the API routes.
 * On HALT the worker closes any open position (existing kill switch / executor; a no-op when flat
 * or in simulation with no position) and refuses new entries until resume.
 */
export const OWNER_HALT_REASON_PREFIX = 'owner_sell_all:';

export interface HaltState {
  halted: boolean;
  reason: string | null;
  requestedAt: string | null;
  requestedBy: string | null;
  appliedAt: string | null;
  source: 'owner' | 'engine' | 'worker' | null;
  /** Monotonic revision so a stale resume cannot overwrite a newer halt (and vice versa). */
  rev: number;
}

export interface HaltCommand {
  action: 'halt' | 'resume';
  reason?: string;
  at?: string;
  by?: string;
  source?: HaltState['source'];
}

export interface HaltApplyResult {
  state: HaltState;
  changed: boolean;
  already: boolean;
  audit: HaltAuditEvent;
}

export interface HaltAuditEvent {
  at: string;
  action: 'halt' | 'resume';
  result: 'applied' | 'idempotent' | 'ignored_stale';
  by: string;
  reason: string | null;
  rev: number;
}

export const EMPTY_HALT: HaltState = {
  halted: false, reason: null, requestedAt: null, requestedBy: null, appliedAt: null, source: null, rev: 0,
};

export function isOwnerHaltReason(reason: string | null | undefined): boolean {
  return Boolean(reason && reason.startsWith(OWNER_HALT_REASON_PREFIX));
}

export function ownerHaltReason(detail: string): string {
  const d = String(detail || 'sell all').replace(/\s+/g, ' ').trim().slice(0, 160);
  return `${OWNER_HALT_REASON_PREFIX}${d}`;
}

export function shouldCloseOpenPositions(h: HaltState): boolean {
  return h.halted;
}

export function shouldBlockNewEntries(h: HaltState): boolean {
  return h.halted;
}

/**
 * Apply a halt/resume command idempotently.
 * A second halt while already halted (or resume while running) is a no-op but is still audited.
 */
export function applyHaltCommand(current: HaltState | null | undefined, cmd: HaltCommand, now = new Date()): HaltApplyResult {
  const prev = current ?? { ...EMPTY_HALT };
  const at = cmd.at ?? now.toISOString();
  const by = (cmd.by ?? 'owner').slice(0, 80);
  const action = cmd.action;
  const reason = action === 'halt' ? ownerHaltReason(cmd.reason ?? 'sell all') : null;

  const already = action === 'halt' ? prev.halted : !prev.halted;
  if (already) {
    const state: HaltState = action === 'halt'
      ? { ...prev, halted: true, reason: reason ?? prev.reason, requestedBy: by, source: cmd.source ?? prev.source ?? 'owner' }
      : { ...prev, halted: false };
    const audit: HaltAuditEvent = { at, action, result: 'idempotent', by, reason: state.reason, rev: prev.rev };
    return { state, changed: false, already: true, audit };
  }

  const rev = prev.rev + 1;
  const state: HaltState = action === 'halt'
    ? { halted: true, reason, requestedAt: at, requestedBy: by, appliedAt: null, source: cmd.source ?? 'owner', rev }
    : { halted: false, reason: null, requestedAt: at, requestedBy: by, appliedAt: at, source: cmd.source ?? 'owner', rev };
  const audit: HaltAuditEvent = { at, action, result: 'applied', by, reason: state.reason, rev };
  return { state, changed: true, already: false, audit };
}

/** Prefer the higher revision; if tied, a halt wins (fail-safe). */
export function mergeHalt(a: HaltState | null | undefined, b: HaltState | null | undefined): HaltState {
  const x = a ?? { ...EMPTY_HALT };
  const y = b ?? { ...EMPTY_HALT };
  if (y.rev > x.rev) return y;
  if (x.rev > y.rev) return x;
  if (x.halted === y.halted) return x.requestedAt && y.requestedAt && y.requestedAt > x.requestedAt ? y : x;
  return x.halted ? x : y;
}

export function markHaltApplied(state: HaltState, at = new Date().toISOString()): HaltState {
  if (!state.halted || state.appliedAt) return state;
  return { ...state, appliedAt: at };
}
