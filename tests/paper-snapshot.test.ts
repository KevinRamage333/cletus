import { describe, expect, it } from 'vitest';
import { buildSnapshot, emptySnapshot, normalizeRow, loadPaperSnapshot, PAPER_STALE_MS } from '@/lib/paper-snapshot';

const now = Date.parse('2026-11-17T17:20:00Z');
const row = (o: Record<string, unknown> = {}) => ({ id: 'evm-base-1', network: 'base', token: 'ABC', token_address: '0xabc', status: 'open', entry_price: 1, current_price: 1.1,
  exit_price: null, size_usd: 15, pnl_usd: 1.2, pnl_pct: 8, exit_reason: null, chart_url: 'https://dexscreener.com/base/0xpair', opened_at: '2026-11-17T17:15:00Z', closed_at: null, simulated: true, ...o });

describe('paper snapshot', () => {
  it('empty when nothing is published: no numbers invented', () => {
    const s = buildSnapshot(null, []);
    expect(s.available).toBe(false);
    expect(s.equityUsd).toBeNull();
    expect(s.totalPnlUsd).toBeNull();
    expect(s.simulated).toBe(true);
  });
  it('refuses a snapshot that is not marked simulated', () => {
    expect(buildSnapshot({ published_at: new Date(now).toISOString(), summary: { simulated: false, equityUsd: 1 } }, [row()], now).available).toBe(false);
  });
  it('drops non-simulated and malformed rows; keeps nulls as null', () => {
    expect(normalizeRow(row({ simulated: false }))).toBeNull();
    expect(normalizeRow(row({ status: 'weird' }))).toBeNull();
    const r = normalizeRow(row({ pnl_usd: null, size_usd: 'x' }))!;
    expect(r.pnlUsd).toBeNull();
    expect(r.sizeUsd).toBeNull();
  });
  it('only allows https dexscreener/geckoterminal chart links', () => {
    expect(normalizeRow(row({ chart_url: 'javascript:alert(1)' }))!.chartUrl).toBeNull();
    expect(normalizeRow(row({ chart_url: 'https://evil.example/x' }))!.chartUrl).toBeNull();
    expect(normalizeRow(row())!.chartUrl).toContain('dexscreener.com');
  });
  it('splits open/closed, sorts, marks stale', () => {
    const summary = { simulated: true, startingUsd: 300, equityUsd: 301, totalPnlUsd: 1, realizedUsd: 0.5, unrealizedUsd: 0.5, openCount: 1, closedCount: 1, wins: 1, losses: 0, winRatePct: 100,
      books: [{ book: 'evm', label: 'EVM networks', startingUsd: 150, cashUsd: 135, equityUsd: 151, open: 1, closed: 1 }], networks: { base: { open: 1, closed: 1, wins: 1, pnlUsd: 1 } } };
    const rows = [row(), row({ id: 'c1', status: 'closed', exit_price: 1.2, closed_at: '2026-11-17T17:10:00Z' })];
    const fresh = buildSnapshot({ published_at: new Date(now - 30_000).toISOString(), summary }, rows, now);
    expect(fresh.available).toBe(true);
    expect(fresh.stale).toBe(false);
    expect(fresh.open).toHaveLength(1);
    expect(fresh.recent).toHaveLength(1);
    expect(fresh.networks[0]).toMatchObject({ network: 'base', open: 1 });
    const old = buildSnapshot({ published_at: new Date(now - PAPER_STALE_MS - 1).toISOString(), summary }, rows, now);
    expect(old.stale).toBe(true);
  });
  it('unconfigured feed returns an honest empty snapshot', async () => {
    const s = await loadPaperSnapshot({});
    expect(s).toEqual(emptySnapshot('paper feed not configured'));
  });
});
