import { describe, it, expect } from 'vitest';
import { getConfig } from '../src/lib/config';
import { defaultSettings, sanitizeSettings, effectiveConfig, withinTradingHours, dailyLimitHit, sizeFromPct, fromConfigPage, to24h, to12h, parseSettings } from '../src/lib/user-settings';
import { parseOhlcv, takeToken } from '../src/lib/gecko';
import { holdingsFromDas, txsFromEnhanced, parseAddress } from '../src/lib/inspector';
import { devAuditFrom } from '../src/lib/dev-audit';
import { looksSecret, cleanText } from '../src/lib/community';
import { trialInfo } from '../src/lib/trial';

const c = getConfig();
const base = defaultSettings(c);

describe('Config page settings', () => {
  it('clamps untrusted input and ignores junk', () => {
    const s = sanitizeSettings({ maxConcurrent: 99, positionSizePct: 500, stopLossPct: 0, tradingStart: '25:00', aggression: 'nope', dailyMaxLossUsd: -50 }, base);
    expect(s.maxConcurrent).toBe(20);
    expect(s.positionSizePct).toBe(25);
    expect(s.stopLossPct).toBe(1);
    expect(s.tradingStart).toBe(base.tradingStart);
    expect(s.aggression).toBeNull();
    expect(s.dailyMaxLossUsd).toBe(50);
  });
  it('maps the saved frontend payload (12h times, lowercase aggression)', () => {
    const s = sanitizeSettings(fromConfigPage({ capital: 5000, activeDays: ['Mon', 'Fri', 'Funday'], startTime: '9:00 AM', endTime: '9:30 PM', aggression: 'max', positionSizePercent: 3, stopLossPercent: 8, takeProfitPercent: 20, dailyProfitTarget: 500, dailyMaxLoss: 50, maxPositions: 7 }), base);
    expect(s).toMatchObject({ capital: 5000, activeDays: ['Mon', 'Fri'], tradingStart: '09:00', tradingEnd: '21:30', tradingHoursEnabled: true, aggression: 'MAXIMUM', positionSizePct: 3, stopLossPct: 8, takeProfitPct: 20, dailyProfitTargetUsd: 500, dailyMaxLossUsd: 50, maxConcurrent: 7 });
    expect(to24h('12:00 AM')).toBe('00:00');
    expect(to24h('12:30 PM')).toBe('12:30');
    expect(to12h('21:30')).toBe('9:30 PM');
    expect(parseSettings('{not json', c)).toEqual(base);
  });
  it('effective config applies overrides but never exceeds the server max positions', () => {
    const e = effectiveConfig({ ...c, maxOpenPositions: 10 }, { ...base, maxConcurrent: 20, stopLossPct: 7, takeProfitPct: 30, aggression: 'AGGRESSIVE' });
    expect(e.maxOpenPositions).toBe(10);
    expect(e.stopLossPct).toBe(7);
    expect(e.takeProfitPct).toBe(30);
    expect(e.minCompositeScore).toBe(0.55);
  });
  it('trading hours gate new entries by day and time (overnight windows too)', () => {
    const s = { ...base, tradingHoursEnabled: true, timezone: 'UTC', tradingStart: '09:00', tradingEnd: '17:00', activeDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] };
    expect(withinTradingHours(s, new Date('2026-11-11T12:00:00Z'))).toBe(true); // Wed noon
    expect(withinTradingHours(s, new Date('2026-11-11T18:00:00Z'))).toBe(false);
    expect(withinTradingHours(s, new Date('2026-11-14T12:00:00Z'))).toBe(false); // Saturday
    const night = { ...s, tradingStart: '22:00', tradingEnd: '02:00', activeDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };
    expect(withinTradingHours(night, new Date('2026-11-11T23:30:00Z'))).toBe(true);
    expect(withinTradingHours(night, new Date('2026-11-11T03:00:00Z'))).toBe(false);
    expect(withinTradingHours({ ...s, tradingHoursEnabled: false }, new Date('2026-11-14T03:00:00Z'))).toBe(true);
  });
  it('daily target / max loss auto-pause, 0 disables', () => {
    expect(dailyLimitHit({ ...base, dailyProfitTargetUsd: 100 }, 100)).toMatch(/target/);
    expect(dailyLimitHit({ ...base, dailyMaxLossUsd: 50 }, -50)).toMatch(/max loss/);
    expect(dailyLimitHit({ ...base }, -10_000)).toBeNull();
  });
  it('position size % of equity', () => {
    expect(sizeFromPct({ ...base, positionSizePct: 2 }, 10_000, 999)).toBe(200);
    expect(sizeFromPct(base, 10_000, 999)).toBe(999);
  });
});

describe('GeckoTerminal', () => {
  it('parses OHLCV newest-first into ascending, de-duplicated candles', () => {
    const j = { data: { attributes: { ohlcv_list: [[180, 1, 2, 0.5, 1.5, 10], [120, 1, 1, 1, 1, 5], [120, 9, 9, 9, 9, 9], [60, 0, 0, 0, 0, 0]] } } };
    expect(parseOhlcv(j).map((x) => x.time)).toEqual([120, 180]);
  });
  it('token bucket respects the per-minute budget and refills', () => {
    const b = { tokens: 2, at: 0 };
    expect(takeToken(b, 2, 0)).toBe(true);
    expect(takeToken(b, 2, 0)).toBe(true);
    expect(takeToken(b, 2, 0)).toBe(false);
    expect(takeToken(b, 2, 30_000)).toBe(true);
  });
});

describe('Inspector + dev audit', () => {
  it('validates addresses', () => {
    expect(parseAddress('So11111111111111111111111111111111111111112')).toBeTruthy();
    expect(parseAddress('not-an-address')).toBeNull();
  });
  it('maps DAS holdings and enhanced txs with counterparties', () => {
    const h = holdingsFromDas({ items: [{ id: 'M1', token_info: { balance: 2_000_000, decimals: 6, symbol: 'AAA', price_info: { price_per_token: 3, total_price: 6 } } }, { id: 'M2', token_info: { balance: 0, decimals: 0 } }, { id: 'NFT' }] });
    expect(h).toEqual([{ mint: 'M1', symbol: 'AAA', name: null, amount: 2, priceUsd: 3, valueUsd: 6 }]);
    const t = txsFromEnhanced([{ signature: 's', timestamp: 1, type: 'SWAP', fee: 5000, nativeTransfers: [{ fromUserAccount: 'A', toUserAccount: 'B' }], tokenTransfers: [{ fromUserAccount: 'B', toUserAccount: 'C' }] }]);
    expect(t[0]).toMatchObject({ type: 'SWAP', feeSol: 0.000005, failed: false, counterparties: ['A', 'B', 'C'] });
  });
  it('flags live mint authority and concentration on tokens', () => {
    const r = devAuditFrom({ address: 'T', kind: 'token', fetchedAt: '', source: ['Helius RPC'], solBalance: 0, holdings: [], holdingsTotalUsd: null, transactions: [], errors: [],
      token: { decimals: 6, supply: 1e9, mintAuthority: 'X'.repeat(44), freezeAuthority: null, topHolders: [{ owner: 'a', pct: 40 }, { owner: 'b', pct: 20 }], priceUsd: 1, marketCap: 1, liquidityUsd: 10_000, symbol: 'T', name: 'T', pairUrl: null } });
    expect(r.status).toBe('high_risk');
    expect(r.findings.find((f) => f.label === 'Top-10 concentration')?.severity).toBe('high');
  });
});

describe('Community safety + trial', () => {
  it('blocks pasted secret keys and bare recovery phrases', () => {
    expect(looksSecret('abandon '.repeat(12).trim())).toBe(true);
    expect(looksSecret('[' + Array(64).fill(1).join(',') + ']')).toBe(true);
    expect(looksSecret('gm everyone, BONK looks heated today')).toBe(false);
    expect(cleanText('hi\u0000 there', 5)).toBe('hi th');
  });
  it('30-day trial countdown', () => {
    const now = Date.parse('2026-11-11T00:00:00Z');
    expect(trialInfo({ createdAt: new Date(now - 10 * 86_400_000), trialStartedAt: null }, now)).toMatchObject({ trialActive: true, daysRemaining: 20 });
    expect(trialInfo({ createdAt: new Date(now - 40 * 86_400_000), trialStartedAt: null }, now).trialActive).toBe(false);
  });
});

import { demoGateDecision } from '@/lib/gate';
describe('demo gate (public preview, no DB)', () => {
  it('sends / and /signup to the demo landing', () => {
    expect(demoGateDecision('/')).toEqual({ action: 'redirect', to: '/demo' });
    expect(demoGateDecision('/signup')).toEqual({ action: 'redirect', to: '/demo' });
  });
  it('allows demo pages, legal, demo APIs and assets', () => {
    for (const p of ['/demo', '/demo/chart', '/demo/wallet', '/demo/dashboard', '/legal', '/api/demo/chart', '/api/health', '/cletus-logo.png', '/_next/static/x.js']) expect(demoGateDecision(p)).toEqual({ action: 'next' });
  });
  it('account pages say coming soon; account APIs answer 503', () => {
    expect(demoGateDecision('/app/config')).toEqual({ action: 'redirect', to: '/demo?soon=%2Fapp%2Fconfig' });
    expect(demoGateDecision('/api/auth/signup')).toEqual({ action: 'soon' });
    expect(demoGateDecision('/api/protected/trade/start')).toEqual({ action: 'soon' });
    expect(demoGateDecision('/api/tokens/chart')).toEqual({ action: 'soon' });
  });
});
