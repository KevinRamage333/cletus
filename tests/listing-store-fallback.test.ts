import { afterEach, describe, expect, it, vi } from 'vitest';

// Audit M4: a DB error must not silently (and permanently) switch production to the /tmp JSON store.
vi.mock('@/lib/db', () => ({ prisma: { cletusVerification: { findMany: vi.fn(async () => { throw Object.assign(new Error('relation does not exist'), { code: 'P2021' }); }), create: vi.fn() }, tokenBoost: { findMany: vi.fn(), create: vi.fn() } } }));

describe('listing-store database fallback', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; vi.resetModules(); });
  it('throws (and logs) in production when the database fails', async () => {
    process.env.DATABASE_URL = 'postgres://x'; delete process.env.CLETUS_DEMO;
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { listVerifications } = await import('@/lib/listing-store');
    await expect(listVerifications()).rejects.toThrow(/does not exist/);
    expect(err).toHaveBeenCalled();
  });
  it('falls back to the file store only in the public demo', async () => {
    process.env.DATABASE_URL = 'postgres://x'; process.env.CLETUS_DEMO = '1'; process.env.CLETUS_LISTINGS_DIR = '/tmp/cletus-listings-test-' + process.pid;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { listVerifications } = await import('@/lib/listing-store');
    await expect(listVerifications()).resolves.toEqual([]);
  });
});
