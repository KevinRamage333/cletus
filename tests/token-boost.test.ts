import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BOOST_TIERS, activeBoostSummaries, boostPaymentsEnabled, boostSafety, boostWindow, isBoostActive, splitBoosted, tierById, type BoostRecord,
} from '@/lib/token-boost';

const H = 3_600_000;
const T0 = Date.parse('2026-11-17T12:00:00Z');
const rec = (o: Partial<BoostRecord>): BoostRecord => ({ id: 'x', network: 'solana', token: 'MintA', tier: '12h', startsAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 12 * H).toISOString(), source: 'owner_grant', status: 'active', createdBy: 'owner', note: null, createdAt: new Date(T0).toISOString(), ...o });

describe('boost tiers and expiry', () => {
  it('has 12h / 24h / 7d tiers with prices unset until the owner decides', () => {
    expect(BOOST_TIERS.map((t) => [t.id, t.hours])).toEqual([['12h', 12], ['24h', 24], ['7d', 168]]);
    expect(BOOST_TIERS.every((t) => t.priceUsd === null)).toBe(true);
    expect(tierById('1y')).toBeNull();
  });
  it('a boost is active only between start and expiry', () => {
    const b = rec({});
    expect(isBoostActive(b, T0 - 1)).toBe(false);
    expect(isBoostActive(b, T0)).toBe(true);
    expect(isBoostActive(b, T0 + 12 * H - 1)).toBe(true);
    expect(isBoostActive(b, T0 + 12 * H)).toBe(false);
    expect(isBoostActive({ ...b, status: 'cancelled' }, T0 + H)).toBe(false);
  });
  it('new boosts start now, or stack after the current one ends', () => {
    const w = boostWindow(tierById('24h')!, [], new Date(T0));
    expect(w.startsAt.getTime()).toBe(T0);
    expect(w.expiresAt.getTime()).toBe(T0 + 24 * H);
    const stacked = boostWindow(tierById('7d')!, [rec({})], new Date(T0 + H));
    expect(stacked.startsAt.getTime()).toBe(T0 + 12 * H);
    expect(stacked.expiresAt.getTime()).toBe(T0 + 12 * H + 168 * H);
    // expired or cancelled boosts do not delay a new one
    expect(boostWindow(tierById('12h')!, [rec({ status: 'cancelled' })], new Date(T0 + H)).startsAt.getTime()).toBe(T0 + H);
    expect(boostWindow(tierById('12h')!, [rec({})], new Date(T0 + 13 * H)).startsAt.getTime()).toBe(T0 + 13 * H);
  });
  it('summaries drop expired boosts and show the end of a stacked run', () => {
    const a = rec({ id: 'a' });
    const b = rec({ id: 'b', startsAt: new Date(T0 + 12 * H).toISOString(), expiresAt: new Date(T0 + 36 * H).toISOString(), tier: '24h' });
    const old = rec({ id: 'c', token: 'MintOld', startsAt: new Date(T0 - 48 * H).toISOString(), expiresAt: new Date(T0 - 36 * H).toISOString() });
    const s = activeBoostSummaries([a, b, old], T0 + H);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ token: 'MintA', expiresAt: new Date(T0 + 36 * H).toISOString() });
    expect(activeBoostSummaries([a, b, old], T0 + 40 * H)).toEqual([]);
  });
});

describe('boost safety and placement', () => {
  const ok = { network: 'solana' as const, mintAuthority: null, freezeAuthority: null, liquidityUsd: 80_000, honeypot: false, sellTaxPct: 0 };
  it('passes a clean token and fails closed on unknown or risky facts', () => {
    expect(boostSafety(ok)).toEqual({ ok: true, reasons: [] });
    expect(boostSafety({ ...ok, mintAuthority: undefined }).ok).toBe(false);
    expect(boostSafety({ ...ok, freezeAuthority: 'F' }).ok).toBe(false);
    expect(boostSafety({ ...ok, liquidityUsd: null }).ok).toBe(false);
    expect(boostSafety({ ...ok, liquidityUsd: 9_000 }).ok).toBe(false);
    expect(boostSafety({ ...ok, honeypot: true }).ok).toBe(false);
    expect(boostSafety({ ...ok, sellTaxPct: 25 }).ok).toBe(false);
    expect(boostSafety({ network: 'base', ownerCanMint: null, liquidityUsd: 1e6, honeypot: false, sellTaxPct: 0 }).ok).toBe(false);
    expect(boostSafety({ network: 'base', ownerCanMint: false, liquidityUsd: 1e6, honeypot: false, sellTaxPct: 0 }).ok).toBe(true);
  });
  it('boosted cards move to their own row in boost order; the rest keep their order', () => {
    const cards = [{ mint: 'A' }, { mint: 'B' }, { mint: 'C' }];
    const boosts = [{ network: 'solana' as const, token: 'C', tier: '12h' as const, expiresAt: '' }, { network: 'base' as const, token: 'A', tier: '12h' as const, expiresAt: '' }];
    expect(splitBoosted(cards, boosts)).toEqual({ boosted: [{ mint: 'C' }], rest: [{ mint: 'A' }, { mint: 'B' }] });
  });
  it('real payment collection is off unless explicitly enabled', () => {
    expect(boostPaymentsEnabled({})).toBe(false);
    expect(boostPaymentsEnabled({ BOOST_PAYMENTS_ENABLED: 'false' })).toBe(false);
    expect(boostPaymentsEnabled({ BOOST_PAYMENTS_ENABLED: '1' })).toBe(false);
    expect(boostPaymentsEnabled({ BOOST_PAYMENTS_ENABLED: 'true' })).toBe(true);
  });
});

/** Boosts must never influence buy decisions: nothing the engine or workers import may reach the boost/listing modules. */
describe('boosts cannot affect the trading engine', () => {
  const root = path.resolve(__dirname, '..');
  const FORBIDDEN = ['src/lib/token-boost.ts', 'src/lib/listing-store.ts', 'src/lib/boost-server.ts', 'src/components/listings/Listings.tsx', 'src/app/api/listings/route.ts'];
  const ENTRY = ['src/lib/engine.ts', 'src/lib/executor.ts', 'src/lib/scorecard.ts', 'src/lib/risk.ts', 'src/lib/dexscreener.ts', 'src/lib/live-guard.ts', 'src/lib/live-sizing.ts', 'src/lib/trade-actions.ts', 'src/app/api/engine/scan/route.ts', 'scripts/live-worker.ts'];
  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith('@/')) base = path.join(root, 'src', spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
    else return null;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) if (existsSync(c) && !c.endsWith('/') && /\.(tsx?|mts)$/.test(c)) return c;
    return null;
  };
  function reachable(entry: string): Set<string> {
    const seen = new Set<string>();
    const stack = [path.join(root, entry)];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f) || !existsSync(f)) continue;
      seen.add(f);
      const src = readFileSync(f, 'utf8');
      for (const m of Array.from(src.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*|import\s+)['"]([^'"]+)['"]/g))) { const r = resolve(f, m[1]); if (r) stack.push(r); }
    }
    return seen;
  }
  it.each(ENTRY.filter((e) => existsSync(path.join(root, e))))('%s never imports boost or listing modules', (entry) => {
    const graph = reachable(entry);
    expect(graph.size).toBeGreaterThan(0);
    for (const f of FORBIDDEN) expect(graph.has(path.join(root, f)), `${entry} reaches ${f}`).toBe(false);
  });
  it('the import walker does detect a real dependency (self-check)', () => {
    expect(reachable('src/app/api/listings/route.ts').has(path.join(root, 'src/lib/token-boost.ts'))).toBe(true);
    expect(reachable('src/app/app/signals/page.tsx').has(path.join(root, 'src/lib/token-boost.ts'))).toBe(true);
  });
  it('boost modules contain no engine hooks (no imports of engine, executor or scorecard)', () => {
    for (const f of ['src/lib/token-boost.ts', 'src/lib/listing-store.ts', 'src/lib/boost-server.ts']) {
      const graph = reachable(f);
      for (const e of ['src/lib/engine.ts', 'src/lib/executor.ts', 'src/lib/scorecard.ts']) expect(graph.has(path.join(root, e))).toBe(false);
    }
  });
});
