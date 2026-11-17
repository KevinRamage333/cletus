import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gateDecision, demoGateDecision, isSitePublic, DEMO_APP_ROUTES } from '@/lib/gate';
import * as content from '@/lib/site-content';
import { SITE_DISCLAIMER, SITE_URL, APP_URL } from '@/lib/site';

const V = '2026-11-16.2', FC = 'fc';
const SITE = ['/', '/about', '/technology', '/features', '/roadmap', '/sponsors', '/developers', '/contact', '/legal', '/legal/risk', '/legal/terms', '/legal/privacy', '/legal/not-financial-advice'];

describe('corporate site gate', () => {
  it('serves every corporate and legal page publicly in both modes', () => {
    for (const p of SITE) {
      expect(isSitePublic(p)).toBe(true);
      expect(gateDecision(p, null, V, V, FC)).toEqual({ action: 'next' });
      expect(demoGateDecision(p)).toEqual({ action: 'next' });
    }
  });
  it('does not leak the site allowlist to look-alike or app paths', () => {
    for (const p of ['/aboutx', '/app', '/app/signals', '/api/protected/stats', '/legalese']) expect(isSitePublic(p)).toBe(false);
  });
  it('keeps the full app behind onboarding outside demo mode', () => {
    for (const p of ['/app', '/app/signals', '/app/paper', '/app/wallet']) expect(gateDecision(p, null, V, V, FC)).toEqual({ action: 'redirect', to: '/signup' });
    expect(gateDecision('/api/protected/trade/start', null, V, V, FC)).toMatchObject({ action: 'deny', status: 401 });
  });
  it('public market API is read-only data and open; protected and kill-switch APIs stay closed in demo', () => {
    expect(gateDecision('/api/market/movers', null, V, V, FC)).toEqual({ action: 'next' });
    expect(demoGateDecision('/api/market/audit')).toEqual({ action: 'next' });
    for (const p of ['/api/kill-switch', '/api/protected/withdraw/confirm', '/api/protected/trade/start', '/api/community/messages', '/api/engine/scan']) expect(demoGateDecision(p)).toEqual({ action: 'soon' });
  });
  it('demo exposes only the DB-free app screens', () => {
    expect(DEMO_APP_ROUTES).toEqual(['/app', '/app/signals', '/app/paper', '/app/portfolio', '/app/tax', '/app/audit', '/app/community', '/app/wallet', '/app/feed', '/app/verified', '/app/boost']);
    for (const p of DEMO_APP_ROUTES) expect(demoGateDecision(p)).toEqual({ action: 'next' });
    for (const p of ['/app/config', '/app/trade', '/app/operations', '/app/wallet/engine']) expect(demoGateDecision(p)).toMatchObject({ action: 'redirect' });
  });
});

/** Remove negated mentions ("no guaranteed returns", "never ... presented as guaranteed") so only affirmative claims remain. */
const affirmative = (t: string) => t.replace(/\b(no|not|never|without|nor)\b[^.]{0,80}?guarantee[ds]?\b[^.]{0,30}/gi, '');
const CLAIM = /guarantee[ds]?\s+(\w+\s+)?(returns?|profits?|gains?|income)/i;
describe('site copy honesty', () => {
  const corpus = JSON.stringify(content) + SITE_DISCLAIMER;
  it('uses the cletustechnology.dev domains', () => {
    expect(SITE_URL).toBe('https://cletustechnology.dev');
    expect(APP_URL).toBe('https://app.cletustechnology.dev');
  });
  it('never claims guaranteed returns, live trading or an existing token', () => {
    expect(affirmative(corpus)).not.toMatch(CLAIM);
    for (const bad of [/live trading is (enabled|active|live)/i, /buy (the )?\$?cletus token/i, /token is (live|available)/i, /staking is (live|available)/i, /risk[- ]free/i]) expect(corpus).not.toMatch(bad);
    expect(SITE_DISCLAIMER).toMatch(/Live trading is not enabled/);
    expect(SITE_DISCLAIMER).toMatch(/No Cletus token, staking program or revenue-sharing arrangement is currently offered/);
  });
  it('has five roadmap phases with honest statuses', () => {
    expect(content.ROADMAP.map((p) => p.n)).toEqual([1, 2, 3, 4, 5]);
    expect(content.ROADMAP.at(-1)!.status).toBe('future');
  });
  it('revenue illustration is the 0.5% Jupiter fee with an 80/20 split', () => {
    expect(content.revenueRow(1_000_000)).toEqual({ volume: 1_000_000, fee: 5_000, cletus: 4_000, jupiter: 1_000 });
  });
  it('the revenue table and every page in the site group carry the required labels', () => {
    const sponsors = readFileSync('src/app/(site)/sponsors/page.tsx', 'utf8');
    expect(sponsors).toMatch(/not projections/i);
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const all = walk('src/app/(site)').filter((f) => f.endsWith('.tsx')).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(affirmative(all)).not.toMatch(CLAIM);
    expect(affirmative('We offer guaranteed returns.')).toMatch(CLAIM); // the detector itself works
    expect(readFileSync('src/app/(site)/layout.tsx', 'utf8')).toMatch(/SiteFooter/);
  });
});
