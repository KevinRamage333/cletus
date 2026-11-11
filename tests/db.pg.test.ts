// Postgres integration test. Runs only when .env.local points DATABASE_URL at Postgres;
// otherwise skipped (e.g. SQLite dev mode or CI without a DB). Never logs connection strings.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import pg from 'pg';

if (fs.existsSync('.env.local') && !process.env.DATABASE_URL?.startsWith('postgres')) {
  try { process.loadEnvFile('.env.local'); } catch { /* ignore */ }
}
const url = process.env.DATABASE_URL ?? '';
const isPg = url.startsWith('postgres');

function pgClient(u: string) {
  const x = new URL(u); x.searchParams.delete('schema'); x.searchParams.delete('sslmode');
  return new pg.Client({ connectionString: x.toString(), ssl: { rejectUnauthorized: false } });
}

describe.skipIf(!isPg)('postgres app schema (Prisma)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  const email = `pgtest-${Date.now()}@test.local`;
  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
  });
  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { email } });
    await prisma?.$disconnect();
  });

  it('round-trips a user + account + position through Prisma, cascading on delete', async () => {
    const user = await prisma.user.create({ data: { email } });
    const acct = await prisma.account.create({ data: { userId: user.id, name: 'pg test', startingBalance: 1000, cashUsd: 1000, peakEquity: 1000 } });
    expect(acct.userId).toBe(user.id);
    const got = await prisma.user.findUnique({ where: { email }, include: { account: true } });
    expect(got?.account?.cashUsd).toBe(1000);
    expect(got?.createdAt).toBeInstanceOf(Date);
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.account.findUnique({ where: { id: acct.id } })).toBeNull();
  });

  it('connection is SSL and the app role cannot touch llc_records or write market_data', async () => {
    const c = pgClient(url); await c.connect();
    try {
      const ssl = await c.query('select ssl from pg_stat_ssl where pid = pg_backend_pid()');
      expect(ssl.rows[0].ssl).toBe(true);
      await expect(c.query('select 1 from llc_records.expenses limit 1')).rejects.toThrow(/permission denied/);
      await expect(c.query(`insert into market_data.pools(address, base_mint) values ('t','t')`)).rejects.toThrow(/permission denied/);
      const r = await c.query('select count(*)::int n from market_data.candles_1m');
      expect(r.rows[0].n).toBeGreaterThanOrEqual(0);
    } finally { await c.end(); }
  });

  it('rejects non-SSL connections', async () => {
    const x = new URL(url); x.searchParams.delete('schema'); x.searchParams.delete('sslmode');
    const c = new pg.Client({ connectionString: x.toString(), ssl: false });
    await expect(c.connect()).rejects.toThrow(/no encryption|pg_hba/);
    await c.end().catch(() => {});
  });
});
