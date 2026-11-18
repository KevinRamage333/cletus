import { describe, expect, it, vi } from 'vitest';
import { listingOverlay } from '@/lib/listing-overlay';
import type { VerificationRecord } from '@/lib/listing-store';
import type { BoostRecord } from '@/lib/token-boost';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const day = 86_400_000;
const ok = { ok: true, drops: [], checkedAt: new Date(NOW).toISOString() };
const dropped = { ok: false, drops: ['Liquidity fell under $10,000.'], checkedAt: new Date(NOW).toISOString() };

function ver(token: string, status: 'verified' | 'not_verified', createdAt: number): VerificationRecord {
  return {
    id: `${token}-${createdAt}`, network: 'solana', token, name: null, symbol: null, wallet: 'w', role: null, status, reasons: [], checks: [],
    issuedAt: status === 'verified' ? new Date(createdAt).toISOString() : null,
    expiresAt: status === 'verified' ? new Date(createdAt + 30 * day).toISOString() : null,
    createdAt: new Date(createdAt).toISOString(),
  };
}
function boost(token: string): BoostRecord {
  return { id: `b-${token}`, network: 'solana', token, tier: '24h', startsAt: new Date(NOW - day).toISOString(), expiresAt: new Date(NOW + day).toISOString(), source: 'owner_grant', status: 'active', createdBy: 'owner', note: null, createdAt: new Date(NOW - day).toISOString() };
}

describe('/api/listings overlay (Audit B1)', () => {
  it('latest record wins: a newer failed audit hides an older badge', async () => {
    const recheck = vi.fn(async () => ok);
    const r = await listingOverlay([ver('AAA', 'verified', NOW - 5 * day), ver('AAA', 'not_verified', NOW - day), ver('BBB', 'verified', NOW - day)], [], NOW, recheck);
    expect(r.verified).toEqual(['solana:BBB']);
  });

  it('drops badges and boosts that fail the live re-check', async () => {
    const recheck = vi.fn(async (_n: string, token: string) => (token === 'BAD' || token === 'BADBOOST' ? dropped : ok));
    const r = await listingOverlay([ver('GOOD', 'verified', NOW - day), ver('BAD', 'verified', NOW - day)], [boost('BADBOOST'), boost('GOODBOOST')], NOW, recheck);
    expect(r.verified).toEqual(['solana:GOOD']);
    expect(r.boosts.map((b) => b.token)).toEqual(['GOODBOOST']);
    expect(r.boosts[0].checkedAt).toBe(ok.checkedAt);
  });

  it('caps re-checks at 50 badges', async () => {
    const recheck = vi.fn(async () => ok);
    const rows = Array.from({ length: 60 }, (_, i) => ver(`T${i}`, 'verified', NOW - day));
    const r = await listingOverlay(rows, [], NOW, recheck);
    expect(r.verified).toHaveLength(50);
    expect(recheck).toHaveBeenCalledTimes(50);
  });
});
