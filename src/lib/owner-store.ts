/**
 * Durable-enough store for the owner dashboard snapshot and halt command.
 *
 * Why this path: the Vercel app cannot reach box Postgres. The box worker
 * therefore PUSHes a signed snapshot to POST /api/internal/owner-snapshot every
 * few seconds, and PULLs halt commands from the same endpoint. On the box the
 * same state is also written to data/owner-state.json (and Prisma's kill switch).
 *
 * Storage order: in-process memory (all runtimes) + filesystem when writable
 * (box, /tmp on Vercel). On-chain Helius reads are the fallback when the
 * snapshot is missing or stale. Halt commands stay in this store until the
 * worker applies them to Postgres.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { HaltAuditEvent, HaltState } from './owner-halt';
import { EMPTY_HALT } from './owner-halt';
import { mergeRequests, type OwnerWithdrawRequest } from './owner-withdraw-queue';

export interface OwnerSnapshot {
  asOf: string;
  payload: unknown;
}

export interface OwnerSharedState {
  snapshot: OwnerSnapshot | null;
  halt: HaltState;
  audit: HaltAuditEvent[];
  /** Owner real-withdrawal requests (site creates, box worker executes). */
  withdrawals?: OwnerWithdrawRequest[];
}

const g = globalThis as unknown as { __cletusOwnerState?: OwnerSharedState };
function mem(): OwnerSharedState {
  if (!g.__cletusOwnerState) g.__cletusOwnerState = { snapshot: null, halt: { ...EMPTY_HALT }, audit: [] };
  return g.__cletusOwnerState;
}

export function ownerStatePath(): string {
  return resolve(process.env.OWNER_STATE_PATH || (process.env.VERCEL ? '/tmp/cletus-owner-state.json' : 'data/owner-state.json'));
}

function readFileState(): OwnerSharedState | null {
  try {
    const p = ownerStatePath();
    if (!existsSync(p)) return null;
    const j = JSON.parse(readFileSync(p, 'utf8')) as OwnerSharedState;
    if (!j || typeof j !== 'object') return null;
    return {
      snapshot: j.snapshot ?? null,
      halt: { ...EMPTY_HALT, ...(j.halt ?? {}) },
      audit: Array.isArray(j.audit) ? j.audit.slice(-200) : [],
      withdrawals: Array.isArray(j.withdrawals) ? j.withdrawals : [],
    };
  } catch {
    return null;
  }
}

function writeFileState(s: OwnerSharedState) {
  try {
    const p = ownerStatePath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(s), { mode: 0o600 });
  } catch {
    /* Vercel may only have /tmp; ignore if that also fails */
  }
}

export function loadOwnerState(): OwnerSharedState {
  const m = mem();
  const f = readFileState();
  if (!f) return m;
  // File wins if it's newer (higher halt rev or later snapshot).
  const fileSnap = f.snapshot?.asOf ? Date.parse(f.snapshot.asOf) : 0;
  const memSnap = m.snapshot?.asOf ? Date.parse(m.snapshot.asOf) : 0;
  const halt = (f.halt?.rev ?? 0) >= (m.halt?.rev ?? 0) ? f.halt : m.halt;
  const snapshot = fileSnap >= memSnap ? f.snapshot : m.snapshot;
  const audit = (f.audit?.length ?? 0) >= (m.audit?.length ?? 0) ? f.audit : m.audit;
  const withdrawals = mergeRequests(m.withdrawals, f.withdrawals);
  const merged = { snapshot, halt, audit, withdrawals };
  g.__cletusOwnerState = merged;
  return merged;
}

export function saveOwnerState(s: OwnerSharedState): OwnerSharedState {
  const next = { snapshot: s.snapshot, halt: s.halt, audit: (s.audit ?? []).slice(-200), withdrawals: mergeRequests(s.withdrawals ?? []) };
  g.__cletusOwnerState = next;
  writeFileState(next);
  return next;
}

export function saveSnapshot(payload: unknown, asOf = new Date().toISOString()): OwnerSharedState {
  const s = loadOwnerState();
  return saveOwnerState({ ...s, snapshot: { asOf, payload } });
}

export function snapshotAgeMs(s: OwnerSharedState = loadOwnerState(), now = Date.now()): number | null {
  if (!s.snapshot?.asOf) return null;
  const t = Date.parse(s.snapshot.asOf);
  return Number.isFinite(t) ? now - t : null;
}

export function snapshotSecret(env: Record<string, string | undefined> = process.env): string | null {
  const a = env.OWNER_SNAPSHOT_SECRET?.trim();
  if (a && a.length >= 16) return a;
  const b = env.SESSION_SECRET?.trim();
  if (b && b.length >= 32) return b;
  return null;
}

export function authorizedSnapshotRequest(req: { headers: Headers }, env: Record<string, string | undefined> = process.env): boolean {
  const secret = snapshotSecret(env);
  if (!secret) return false;
  const hdr = req.headers.get('authorization') ?? '';
  const token = hdr.toLowerCase().startsWith('bearer ') ? hdr.slice(7).trim() : (req.headers.get('x-owner-sync') ?? '').trim();
  if (!token || token.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

export function defaultPushUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.OWNER_SNAPSHOT_PUSH_URL?.trim();
  if (explicit === 'off' || explicit === 'false') return null;
  if (explicit) return explicit;
  const site = env.NEXT_PUBLIC_SITE_URL?.trim() || env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (site) {
    try {
      const u = new URL(site.includes('://') ? site : `https://${site}`);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return null;
      return `${u.origin}/api/internal/owner-snapshot`;
    } catch { /* fall through */ }
  }
  return 'https://cletus-autonomous-trader.vercel.app/api/internal/owner-snapshot';
}

/** Push state from the box to Vercel. No-ops in tests, on Vercel itself, or without a secret. */
export async function pushOwnerState(state: OwnerSharedState = loadOwnerState(), env: Record<string, string | undefined> = process.env): Promise<{ ok: boolean; error?: string }> {
  if (env.VERCEL || env.VITEST === 'true' || env.NODE_ENV === 'test') return { ok: false, error: 'skipped' };
  const url = defaultPushUrl(env);
  const secret = snapshotSecret(env);
  if (!url || !secret) return { ok: false, error: 'push url or secret missing' };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(state),
    });
    if (!r.ok) return { ok: false, error: `push ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function pullOwnerState(env: Record<string, string | undefined> = process.env): Promise<OwnerSharedState | null> {
  if (env.VERCEL || env.VITEST === 'true' || env.NODE_ENV === 'test') return null;
  const url = defaultPushUrl(env);
  const secret = snapshotSecret(env);
  if (!url || !secret) return null;
  try {
    const r = await fetch(url, { headers: { authorization: `Bearer ${secret}` }, cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json() as OwnerSharedState;
    if (!j || typeof j !== 'object') return null;
    return { snapshot: j.snapshot ?? null, halt: { ...EMPTY_HALT, ...(j.halt ?? {}) }, audit: Array.isArray(j.audit) ? j.audit : [], withdrawals: Array.isArray(j.withdrawals) ? j.withdrawals : [] };
  } catch {
    return null;
  }
}
