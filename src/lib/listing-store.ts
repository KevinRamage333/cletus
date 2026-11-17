/**
 * Persistence for Cletus Verified records and Token Boosts.
 * Uses Postgres (Prisma models CletusVerification / TokenBoost) when DATABASE_URL is set and the tables exist;
 * otherwise falls back to a small JSON file store (data/listings, or /tmp on Vercel) so the public demo works
 * without a database. The file store is per-instance and not durable on serverless hosts.
 *
 * DISPLAY ONLY: never import this from the trading engine (enforced by tests/token-boost.test.ts).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BoostRecord } from './token-boost';
import type { ListingNetwork, VerifyCheck } from './verified';

export interface VerificationRecord {
  id: string;
  network: ListingNetwork;
  token: string;
  name: string | null;
  symbol: string | null;
  wallet: string;
  role: string | null;
  status: 'verified' | 'not_verified';
  reasons: string[];
  checks: VerifyCheck[];
  issuedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function listingsDir(env: Record<string, string | undefined> = process.env): string {
  return env.CLETUS_LISTINGS_DIR || (env.VERCEL ? '/tmp/cletus-listings' : join(process.cwd(), 'data', 'listings'));
}
const file = (name: string) => join(listingsDir(), `${name}.json`);
function readList<T>(name: string): T[] {
  try { const v = JSON.parse(readFileSync(file(name), 'utf8')); return Array.isArray(v) ? v as T[] : []; } catch { return []; }
}
function writeList<T>(name: string, rows: T[]) {
  mkdirSync(listingsDir(), { recursive: true });
  const tmp = `${file(name)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(rows.slice(-2000), null, 1));
  renameSync(tmp, file(name));
}

type PrismaLike = {
  cletusVerification: { create: (a: unknown) => Promise<unknown>; findMany: (a: unknown) => Promise<unknown[]> };
  tokenBoost: { create: (a: unknown) => Promise<unknown>; findMany: (a: unknown) => Promise<unknown[]> };
};
async function db(): Promise<PrismaLike | null> {
  if (!process.env.DATABASE_URL) return null;
  const { prisma } = await import('./db');
  return prisma as unknown as PrismaLike;
}
const fileFallbackAllowed = () => process.env.CLETUS_DEMO === '1';
/**
 * No DATABASE_URL: file store (local/demo). With a database, a DB error falls back to the file store only in the
 * public demo (CLETUS_DEMO=1) and only for that call; in production it is logged and thrown (Audit M4), never sticky.
 */
async function withDb<T>(fnDb: (p: PrismaLike) => Promise<T>, fnFile: () => T): Promise<T> {
  const p = await db();
  if (!p) return fnFile();
  try { return await fnDb(p); } catch (e) {
    const code = (e as { code?: string })?.code;
    console.error(`[listing-store] database error${code ? ` ${code}` : ''}: ${String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200)}`);
    if (fileFallbackAllowed()) return fnFile();
    throw e;
  }
}
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));
function rowToVerification(r: Record<string, unknown>): VerificationRecord {
  return { ...(r as unknown as VerificationRecord), issuedAt: iso(r.issuedAt), expiresAt: iso(r.expiresAt), createdAt: iso(r.createdAt) as string };
}
function rowToBoost(r: Record<string, unknown>): BoostRecord {
  return { ...(r as unknown as BoostRecord), startsAt: iso(r.startsAt) as string, expiresAt: iso(r.expiresAt) as string, createdAt: iso(r.createdAt) as string };
}

export async function saveVerification(v: Omit<VerificationRecord, 'id' | 'createdAt'>): Promise<VerificationRecord> {
  const rec: VerificationRecord = { ...v, id: randomUUID(), createdAt: new Date().toISOString() };
  return withDb(async (p) => rowToVerification(await p.cletusVerification.create({ data: { ...rec, issuedAt: rec.issuedAt ? new Date(rec.issuedAt) : null, expiresAt: rec.expiresAt ? new Date(rec.expiresAt) : null, createdAt: new Date(rec.createdAt) } }) as Record<string, unknown>),
    () => { writeList('verifications', [...readList<VerificationRecord>('verifications'), rec]); return rec; });
}

export async function listVerifications(filter: { network?: ListingNetwork; token?: string } = {}): Promise<VerificationRecord[]> {
  const where: Record<string, string> = {};
  if (filter.network) where.network = filter.network;
  if (filter.token) where.token = filter.token;
  return withDb(async (p) => (await p.cletusVerification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 })).map((r) => rowToVerification(r as Record<string, unknown>)),
    () => readList<VerificationRecord>('verifications').filter((r) => (!filter.network || r.network === filter.network) && (!filter.token || r.token === filter.token)).reverse());
}

export async function saveBoost(b: Omit<BoostRecord, 'id' | 'createdAt'>): Promise<BoostRecord> {
  const rec: BoostRecord = { ...b, id: randomUUID(), createdAt: new Date().toISOString() };
  return withDb(async (p) => rowToBoost(await p.tokenBoost.create({ data: { ...rec, startsAt: new Date(rec.startsAt), expiresAt: new Date(rec.expiresAt), createdAt: new Date(rec.createdAt) } }) as Record<string, unknown>),
    () => { writeList('boosts', [...readList<BoostRecord>('boosts'), rec]); return rec; });
}

/** Boosts that have not expired (and stacked future ones). Expired boosts are kept for the audit trail but not returned. */
export async function listBoosts(filter: { network?: ListingNetwork; token?: string; includeExpired?: boolean } = {}): Promise<BoostRecord[]> {
  const now = new Date();
  const where: Record<string, unknown> = {};
  if (filter.network) where.network = filter.network;
  if (filter.token) where.token = filter.token;
  if (!filter.includeExpired) where.expiresAt = { gt: now };
  return withDb(async (p) => (await p.tokenBoost.findMany({ where, orderBy: { startsAt: 'asc' }, take: 500 })).map((r) => rowToBoost(r as Record<string, unknown>)),
    () => readList<BoostRecord>('boosts').filter((r) => (!filter.network || r.network === filter.network) && (!filter.token || r.token === filter.token) && (filter.includeExpired || new Date(r.expiresAt) > now)));
}
