import { describe, it, expect } from 'vitest';
import { kolConfig, extractSolanaMints, kolQueries, calloutsFromSearch, evaluateKolGates, isRapidLaunch, rugcheckTopClusterPct, kolExitPlan, kolPlanValid, kolOverrides, isKolPlan, DEFAULT_KOLS } from '@/lib/kol-mode';
import { topClusterPct } from '@/lib/bubblemaps';

const MINT = 'GLY7h4BLgJfxmJmSRr5azXeREyXM6AxHmzExxz7Vpump';
const cfg = kolConfig({ KOL_MODE: 'on' });
const okReport = { totalHolders: 400, creator: 'Cr8r', creatorBalance: 10, token: { supply: 1000 }, launchpad: { name: 'Pump.Fun', platform: 'pump_fun' }, deployPlatform: 'unknown', creatorTokens: null, insiderNetworks: [{ currentHolding: 50 }], risks: [] };
const meta = { createdOn: 'https://pump.fun', website: 'https://x.com/foo' };

describe('KOL mode config', () => {
  it('defaults: $5k-$25k, scaled gates, 15% TP / 7% SL, seed list', () => {
    expect(cfg.enabled).toBe(true);
    expect([cfg.minMcap, cfg.maxMcap]).toEqual([5000, 25000]);
    expect([cfg.minVol5mUsd, cfg.buyVolMinUsd, cfg.minLiquidityUsd]).toEqual([500, 1000, 2500]);
    expect([cfg.takeProfitPct, cfg.stopLossPct, cfg.minHolders, cfg.maxClusterPct]).toEqual([15, 7, 150, 15]);
    expect(cfg.accounts).toEqual(DEFAULT_KOLS);
    expect(kolConfig({}).enabled).toBe(false);
    expect(kolConfig({ KOL_ACCOUNTS: '@a_b, bad-handle ,c' }).accounts).toEqual(['a_b', 'c']);
  });
});

describe('callouts', () => {
  it('extracts CAs and skips SOL/USDC and plain words', () => {
    expect(extractSolanaMints(`aping ${MINT} now, not So11111111111111111111111111111111111111112`)).toEqual([MINT]);
    expect(extractSolanaMints('abcdefghijkmnopqrstuvwxyzABCDEFGHJK')).toEqual([]);
  });
  it('chunks queries under the limit', () => {
    const qs = kolQueries(DEFAULT_KOLS, 200);
    expect(qs.length).toBeGreaterThan(1);
    for (const q of qs) expect(q.length).toBeLessThanOrEqual(200);
    expect(qs.join(' ')).toContain('from:Cupseyy');
  });
  it('parses X search, keeps the window, dedupes by mint', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    const json = { data: [
      { id: '1', author_id: 'u1', text: `CA ${MINT}`, created_at: '2026-11-12T11:50:00Z' },
      { id: '2', author_id: 'u2', text: `${MINT} again`, created_at: '2026-11-12T11:55:00Z' },
      { id: '3', author_id: 'u1', text: 'old 9AsedYw9mCCCa7mFpQ97QDAcJ1sGtYxx9G9REcYupump', created_at: '2026-11-12T10:00:00Z' },
    ], includes: { users: [{ id: 'u1', username: 'Cupseyy' }, { id: 'u2', username: 'orangie' }] } };
    const c = calloutsFromSearch(json, now, 30);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ mint: MINT, handle: 'orangie', url: 'https://x.com/orangie/status/2' });
  });
});

describe('KOL gates', () => {
  it('passes a clean coin with Bubblemaps data', () => {
    const g = evaluateKolGates({ report: okReport, bubblemapsTopClusterPct: 8, metadata: meta }, cfg);
    expect(g.reasons).toEqual([]);
    expect(g.pass).toBe(true);
  });
  it('requires Bubblemaps unless the RugCheck fallback is on', () => {
    expect(evaluateKolGates({ report: okReport, bubblemapsTopClusterPct: null, metadata: meta }, cfg).reasons).toContain('Bubblemaps cluster data unavailable');
    const fb = kolConfig({ KOL_MODE: 'on', KOL_CLUSTER_FALLBACK: 'rugcheck' });
    const g = evaluateKolGates({ report: okReport, bubblemapsTopClusterPct: null, metadata: meta }, fb);
    expect(g.pass).toBe(true);
    expect(g.clusterSource).toBe('rugcheck');
    expect(rugcheckTopClusterPct(okReport)).toBe(5);
  });
  it('rejects big clusters, few holders, rapidlaunch, heavy/serial devs, unreadable metadata', () => {
    const r = (o: object, m: Record<string, unknown> | null = meta, b: number | null = 5) => evaluateKolGates({ report: { ...okReport, ...o }, bubblemapsTopClusterPct: b, metadata: m }, cfg).reasons.join('|');
    expect(r({}, meta, 30)).toMatch(/cluster 30.0% > 15%/);
    expect(r({ totalHolders: 90 })).toMatch(/holders 90 < 150/);
    expect(r({}, { createdOn: 'https://rapidlaunch.io' })).toMatch(/rapidlaunch/);
    expect(r({ creatorBalance: 200 })).toMatch(/dev holds 20.0%/);
    expect(r({ creatorTokens: [1, 2, 3, 4, 5] })).toMatch(/serial launcher/);
    expect(r({ risks: [{ name: 'Creator history of rugged tokens' }] })).toMatch(/dev risk/);
    expect(r({}, null)).toMatch(/metadata unreadable/);
    expect(evaluateKolGates({ report: null, bubblemapsTopClusterPct: 1, metadata: meta }, cfg).pass).toBe(false);
    expect(isRapidLaunch({ launchpad: { name: 'Rapid Launch' } }, null)).toBe(true);
  });
});

describe('KOL exits', () => {
  it('+15% take (whole position), -7% stop, no ladder/trail', () => {
    const p = kolExitPlan(cfg, 0.5, 3000);
    expect(isKolPlan(p)).toBe(true);
    expect(kolPlanValid(p)).toBe(true);
    const o = kolOverrides(p);
    expect(o).toMatchObject({ stopLossPct: 7, takeProfitPct: 15, tpLadder: [], enableTrailingStop: false });
    expect(kolPlanValid({ ...p, stopLossPct: 5 })).toBe(false);
  });
  it('bubblemaps share parsing', () => {
    expect(topClusterPct({ clusters: [{ share: 0.12 }, { share: 0.03 }] })).toBeCloseTo(12);
    expect(topClusterPct({ clusters: [] })).toBe(0);
    expect(topClusterPct({})).toBeNull();
  });
});
