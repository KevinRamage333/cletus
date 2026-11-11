import { describe, it, expect } from 'vitest';
import { evaluateAudit, type RugcheckReport } from '@/lib/audit';

const P = { maxHolderConcentration: 0.3, requireLiquidityLock: true, minLpLockedPct: 80, maxAuditRiskScore: 69, maxSellPriceImpactPct: 25 };
const clean: RugcheckReport = {
  mintAuthority: null, freezeAuthority: null, score_normalised: 5, rugged: false, risks: [],
  markets: [{ pubkey: 'POOL', lp: { lpLockedPct: 100 } }],
  knownAccounts: { POOL: { name: 'Pump Fun', type: 'AMM' } },
  topHolders: [{ owner: 'POOL', address: 'a1', pct: 60 }, { owner: 'w1', address: 'a2', pct: 4 }],
  totalMarketLiquidity: 20000,
};
const sellOk = { routeFound: true, priceImpactPct: 1.2 };
const failed = (r: ReturnType<typeof evaluateAudit>) => r.checks.filter((c) => !c.passed).map((c) => c.name);

describe('pre-trade security audit', () => {
  it('passes a clean token (pool holdings are excluded from concentration)', () => {
    const r = evaluateAudit(clean, sellOk, P);
    expect(failed(r)).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.topHolderPct).toBe(4);
  });
  it('fails on mint authority', () => expect(failed(evaluateAudit({ ...clean, mintAuthority: 'X' }, sellOk, P))).toContain('mint_authority'));
  it('fails on freeze authority', () => expect(failed(evaluateAudit({ ...clean, freezeAuthority: 'X' }, sellOk, P))).toContain('freeze_authority'));
  it('fails when LP is not locked', () => expect(failed(evaluateAudit({ ...clean, markets: [{ pubkey: 'POOL', lp: { lpLockedPct: 10 } }] }, sellOk, P))).toContain('lp_locked'));
  it('fails honeypots (no sell route or extreme impact)', () => {
    expect(failed(evaluateAudit(clean, { routeFound: false, priceImpactPct: null }, P))).toContain('honeypot');
    expect(failed(evaluateAudit(clean, { routeFound: true, priceImpactPct: 80 }, P))).toContain('honeypot');
    expect(failed(evaluateAudit(clean, null, P))).toContain('honeypot');
  });
  it('fails on holder concentration', () => {
    expect(failed(evaluateAudit({ ...clean, topHolders: [{ owner: 'whale', pct: 45 }] }, sellOk, P))).toContain('holder_concentration');
  });
  it('fails on high risk score, danger risks, rugged', () => {
    expect(failed(evaluateAudit({ ...clean, score_normalised: 90 }, sellOk, P))).toContain('risk_score');
    expect(failed(evaluateAudit({ ...clean, risks: [{ name: 'Large Amount of LP Unlocked', level: 'danger' }] }, sellOk, P))).toContain('no_danger_risks');
    expect(failed(evaluateAudit({ ...clean, rugged: true }, sellOk, P))).toContain('not_rugged');
  });
  it('fails closed when the report is unavailable', () => expect(evaluateAudit(null, sellOk, P).passed).toBe(false));
});
