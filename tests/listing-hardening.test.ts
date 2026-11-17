import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cumulativePnlSeries } from '@/lib/live-chart';
import { evaluateVerificationChecks, latestRecordByToken, recheckDrops, type TokenSecurityFacts } from '@/lib/verified';
import { _resetListingCaches, cachedTokenFacts, recheckListing } from '@/lib/listing-recheck';
import { _resetRequestLimits, allowAll, clientIp, takeToken } from '@/lib/request-limit';
import { consumeNonceInMemory } from '@/lib/withdraw-nonce';
import { matchesPublicPrefix, gateDecision } from '@/lib/gate';

const DAY = 86_400;
const facts = (o: Partial<TokenSecurityFacts> = {}): TokenSecurityFacts => ({
  network: 'base', token: '0x' + 'a'.repeat(40), name: 'T', symbol: 'T', controllers: [], ownerCanMint: false,
  top1Pct: 5, top10Pct: 20, liquidityUsd: 100_000, lpLockedOrBurnedPct: 95, honeypot: false, sellTaxPct: 0, buyTaxPct: 0, sources: [], errors: [], ...o,
});

describe('community P&L privacy floor (Audit H1)', () => {
  it('rolls quiet days forward until at least 5 distinct accounts are in a point', () => {
    const rows = [
      { closedAt: new Date(0 * DAY * 1000), pnlUsd: 10, accountId: 'a' },
      ...['a', 'b', 'c', 'd', 'e'].map((id) => ({ closedAt: new Date(1 * DAY * 1000 + 60_000), pnlUsd: 1, accountId: id })),
      { closedAt: new Date(2 * DAY * 1000), pnlUsd: 99, accountId: 'z' },
    ];
    const s = cumulativePnlSeries(rows, DAY, 5);
    expect(s).toEqual([{ time: DAY, value: 15 }]); // day 0 (one member) merged into day 1; day 2 (one member) withheld
  });
  it('without a floor every bucket is a point (old behaviour for the owner view)', () => {
    expect(cumulativePnlSeries([{ closedAt: new Date(0), pnlUsd: 3 }], DAY)).toEqual([{ time: 0, value: 3 }]);
  });
  it('rows without an account id never satisfy the floor', () => {
    expect(cumulativePnlSeries(Array.from({ length: 9 }, () => ({ closedAt: new Date(0), pnlUsd: 1 })), DAY, 5)).toEqual([]);
  });
});

describe('verification checks fail closed on EVM (Audit H2)', () => {
  const state = (f: TokenSecurityFacts, id: string) => evaluateVerificationChecks(f).find((c) => c.id === id)!;
  it('unknown honeypot / tax / LP are required unknowns on EVM', () => {
    expect(state(facts({ honeypot: null }), 'honeypot')).toMatchObject({ state: 'unknown', required: true });
    expect(state(facts({ buyTaxPct: null }), 'honeypot')).toMatchObject({ state: 'unknown', required: true });
    expect(state(facts({ lpLockedOrBurnedPct: null }), 'lp')).toMatchObject({ state: 'unknown', required: true });
  });
  it('buy tax over 10% fails', () => {
    expect(state(facts({ buyTaxPct: 11 }), 'honeypot').state).toBe('fail');
  });
  it('Solana unknown honeypot stays optional', () => {
    expect(state(facts({ network: 'solana', honeypot: null, sellTaxPct: null, buyTaxPct: null, mintAuthority: null, freezeAuthority: null }), 'honeypot').required).toBe(false);
  });
});

describe('badge and boost re-checks (Audit H3)', () => {
  beforeEach(() => _resetListingCaches());
  it('drops on low liquidity, honeypot, tax, or an authority change', () => {
    expect(recheckDrops(facts())).toEqual([]);
    expect(recheckDrops(facts({ liquidityUsd: 9_000 }))).toHaveLength(1);
    expect(recheckDrops(facts({ honeypot: true }))).toHaveLength(1);
    expect(recheckDrops(facts({ ownerCanMint: true }))).toHaveLength(1);
    expect(recheckDrops(facts({ network: 'solana', mintAuthority: 'M', freezeAuthority: null }))).toHaveLength(1);
  });
  it('latest record wins', () => {
    const rows = [
      { network: 'solana', token: 'X', status: 'verified', createdAt: '2026-11-01T00:00:00Z' },
      { network: 'solana', token: 'X', status: 'not_verified', createdAt: '2026-11-10T00:00:00Z' },
    ];
    expect(latestRecordByToken(rows)).toEqual([rows[1]]);
  });
  it('caches a recheck for ~1h and shares facts for 60s', async () => {
    const gather = vi.fn(async () => facts({ liquidityUsd: 5_000 }));
    const t0 = 1_000_000;
    const a = await recheckListing('base', '0xabc', t0, gather);
    expect(a.ok).toBe(false);
    expect(a.checkedAt).toBe(new Date(t0).toISOString());
    await recheckListing('base', '0xabc', t0 + 30 * 60_000, gather);
    expect(gather).toHaveBeenCalledTimes(1);
    await recheckListing('base', '0xabc', t0 + 61 * 60_000, gather);
    expect(gather).toHaveBeenCalledTimes(2);
    await cachedTokenFacts('base', '0xdef', t0, gather);
    await cachedTokenFacts('base', '0xdef', t0 + 59_000, gather);
    expect(gather).toHaveBeenCalledTimes(3);
  });
  it('sources down with no prior result: not dropped, but never claims a fresh check', async () => {
    const r = await recheckListing('base', '0x1', 5, async () => { throw new Error('down'); });
    expect(r).toEqual({ ok: true, drops: [], checkedAt: null });
  });
});

describe('rate limits and single-use nonces (Audit M1/M2)', () => {
  beforeEach(() => _resetRequestLimits());
  it('fixed window per key', () => {
    expect(takeToken('k', 2, 1000, 0)).toBe(true);
    expect(takeToken('k', 2, 1000, 1)).toBe(true);
    expect(takeToken('k', 2, 1000, 2)).toBe(false);
    expect(takeToken('k', 2, 1000, 1000)).toBe(true);
    expect(allowAll([['ip', 5], ['w', 0]], 1000, 0)).toBe(false);
  });
  it('client ip from proxy headers', () => {
    expect(clientIp({ headers: new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }) })).toBe('1.2.3.4');
    expect(clientIp({ headers: new Headers() })).toBe('unknown');
  });
  it('a nonce is accepted once per purpose', () => {
    expect(consumeNonceInMemory('verified-siws', 'n1', Date.now() + 60_000)).toBe(true);
    expect(consumeNonceInMemory('verified-siws', 'n1', Date.now() + 60_000)).toBe(false);
    expect(consumeNonceInMemory('onboarding-siws', 'n1', Date.now() + 60_000)).toBe(true);
    expect(consumeNonceInMemory('verified-siws', '', Date.now() + 60_000)).toBe(false);
  });
});

describe('public path matching is segment-exact (PR #98 low)', () => {
  it('prefixes match whole segments only', () => {
    expect(matchesPublicPrefix('/owner', ['/owner'])).toBe(true);
    expect(matchesPublicPrefix('/owner/desk', ['/owner'])).toBe(true);
    expect(matchesPublicPrefix('/ownerx', ['/owner'])).toBe(false);
    expect(matchesPublicPrefix('/livepanel', ['/live'])).toBe(false);
    expect(matchesPublicPrefix('/favicon.ico', ['/favicon'])).toBe(true);
    expect(matchesPublicPrefix('/api/auth/x', ['/api/auth/'])).toBe(true);
    expect(matchesPublicPrefix('/cletus-hero.jpg.evil', ['/cletus-hero.jpg'])).toBe(false);
  });
  it('/ownerx is not public without a session', () => {
    expect(gateDecision('/ownerx', null, 'v1')).not.toEqual({ action: 'next' });
  });
});
