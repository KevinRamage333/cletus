import { describe, it, expect } from 'vitest';
import { providerOrder, withFallback } from '@/lib/providers';
import { parseChatSSE, parseChatCompletion, parseResponsesOutput, xaiConfig, XAI_DEFAULT_MODEL } from '@/lib/xai';
import { toJsonSchema } from '@/lib/brain/xai-chat';
import { checkLimit, newLimiterState, recordCall, record429, recordSuccess, parseRetryDelayMs } from '@/lib/brain/ratelimit';
import { narrativeOf, portfolioCheck, mapLimit } from '@/lib/portfolio';
import { buildConfig, MCAP_PRESETS, parseMcapPreset } from '@/lib/config';
import { rankCandidates } from '@/lib/signals';
import { shouldResummarise } from '@/lib/news';

describe('Brain provider selection', () => {
  it('defaults to gemini then xai then mock', () => {
    expect(providerOrder({ hasGeminiKey: true, hasXaiKey: true })).toEqual(['gemini', 'xai', 'mock']);
    expect(providerOrder({ BRAIN_PROVIDER: 'xai', hasGeminiKey: true, hasXaiKey: true })).toEqual(['xai', 'gemini', 'mock']);
    expect(providerOrder({ hasGeminiKey: false, hasXaiKey: true })).toEqual(['xai', 'mock']);
    expect(providerOrder({ hasGeminiKey: false, hasXaiKey: false })).toEqual(['mock']);
    expect(providerOrder({ BRAIN_PROVIDER: 'mock', hasGeminiKey: true, hasXaiKey: true })).toEqual(['mock']);
    expect(providerOrder({ hasGeminiKey: true, hasXaiKey: true, enableAiBrain: false })).toEqual(['mock']);
  });
  it('falls back to the next provider on errors', async () => {
    const r = await withFallback(['gemini', 'xai', 'mock'], async (p) => { if (p !== 'mock') throw new Error(`${p} down`); return 'ok'; });
    expect(r.provider).toBe('mock');
    expect(r.errors.map((e) => e.provider)).toEqual(['gemini', 'xai']);
    const g = await withFallback(['gemini', 'xai', 'mock'], async (p) => p);
    expect(g).toMatchObject({ provider: 'gemini', errors: [] });
    await expect(withFallback(['gemini'], async () => { throw new Error('x'); })).rejects.toThrow(/all Brain providers failed/);
  });
});

describe('xAI client', () => {
  it('reads config with a configurable model', () => {
    expect(xaiConfig({}).key).toBeNull();
    expect(xaiConfig({}).model).toBe(XAI_DEFAULT_MODEL);
    expect(xaiConfig({ XAI_API_KEY: 'k', XAI_MODEL: 'grok-x' })).toMatchObject({ key: 'k', model: 'grok-x' });
    expect(XAI_DEFAULT_MODEL).toBe('grok-4-fast-non-reasoning');
    expect(parseChatCompletion({ choices: [{ message: { content: '  pong  ' } }], model: 'grok-4-fast-non-reasoning' })).toEqual({ text: 'pong', model: 'grok-4-fast-non-reasoning' });
    expect(parseChatCompletion({})).toEqual({ text: '', model: undefined });

  });
  it('parses streamed content and tool-call deltas', () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"get_","arguments":"{\\"li"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"status","arguments":"mit\\":3}"}}]},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ].join('\n');
    const r = parseChatSSE(sse);
    expect(r.content).toBe('Hello');
    expect(r.toolCalls).toEqual([{ id: 'c1', type: 'function', function: { name: 'get_status', arguments: '{"limit":3}' } }]);
    expect(r.finishReason).toBe('tool_calls');
  });
  it('parses Responses API output and citations', () => {
    const out = parseResponsesOutput({ output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'News.', annotations: [{ type: 'url_citation', url: 'https://a.com', title: 'A' }] }] }], citations: ['https://b.com'] });
    expect(out.text).toBe('News.');
    expect(out.sources).toEqual([{ url: 'https://a.com', title: 'A' }, { url: 'https://b.com', title: 'https://b.com' }]);
  });
  it('converts Gemini tool schemas to JSON schema', () => {
    expect(toJsonSchema({ type: 'OBJECT', properties: { limit: { type: 'NUMBER' } }, required: ['limit'] })).toEqual({ type: 'object', properties: { limit: { type: 'number' } }, required: ['limit'] });
    expect(toJsonSchema(undefined)).toEqual({ type: 'object', properties: {} });
  });
});

describe('Gemini free-tier limiter', () => {
  const P = { minIntervalMs: 6000, dailyCap: 2, baseBackoffMs: 30000, maxBackoffMs: 120000 };
  it('spaces calls, caps per day and backs off on 429', () => {
    let s = newLimiterState();
    const t = Date.parse('2026-11-11T12:00:00Z');
    expect(checkLimit(s, t, P)).toEqual({ ok: true, waitMs: 0 });
    s = recordCall(s, t);
    expect(checkLimit(s, t + 1000, P)).toEqual({ ok: true, waitMs: 5000 });
    s = recordCall(s, t + 7000);
    expect(checkLimit(s, t + 20000, P)).toMatchObject({ ok: false });
    expect(checkLimit(s, t + 86_400_000, P)).toMatchObject({ ok: true }); // new day
    s = record429(newLimiterState(), t, P, 45000);
    expect(checkLimit(s, t + 40000, P)).toMatchObject({ ok: false });
    expect(checkLimit(s, t + 46000, P)).toMatchObject({ ok: true });
    s = record429(s, t, P, null);
    expect(s.cooldownUntil - t).toBe(60000); // exponential
    expect(recordSuccess(s).strikes).toBe(0);
    expect(parseRetryDelayMs(null, '{"retryDelay": "32s"}')).toBe(32000);
    expect(parseRetryDelayMs('10', '')).toBe(10000);
  });
  it('reuses cached news summaries', () => {
    const now = new Date();
    expect(shouldResummarise({ lastAiAt: null, newItems: 0, now, cacheMinutes: 60, minNewItems: 8 })).toBe(true);
    expect(shouldResummarise({ lastAiAt: new Date(now.getTime() - 10 * 60_000), newItems: 20, now, cacheMinutes: 60, minNewItems: 8 })).toBe(false);
    expect(shouldResummarise({ lastAiAt: new Date(now.getTime() - 20 * 60_000), newItems: 20, now, cacheMinutes: 60, minNewItems: 8 })).toBe(true);
    expect(shouldResummarise({ lastAiAt: new Date(now.getTime() - 30 * 60_000), newItems: 2, now, cacheMinutes: 60, minNewItems: 8 })).toBe(false);
    expect(shouldResummarise({ lastAiAt: new Date(now.getTime() - 61 * 60_000), newItems: 0, now, cacheMinutes: 60, minNewItems: 8 })).toBe(true);
  });
});

describe('portfolio safety', () => {
  const PP = { maxOpenPositions: 20, maxTotalExposurePct: 60, maxPositionsPerCluster: 3 };
  const pos = (i: number, extra = {}) => ({ mint: `m${i}`, sizeUsd: 100, narrative: null, creator: null, ...extra });
  it('enforces max open, duplicates, exposure, narrative and dev clusters', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => pos(i));
    expect(portfolioCheck(twenty, { mint: 'x', sizeUsd: 100, narrative: null, creator: null }, 100000, PP).reasons[0]).toMatch(/20\/20/);
    expect(portfolioCheck([pos(1)], { mint: 'm1', sizeUsd: 100, narrative: null, creator: null }, 10000, PP).reasons[0]).toMatch(/duplicate/);
    const cats = [pos(1, { narrative: 'cats' }), pos(2, { narrative: 'cats' }), pos(3, { narrative: 'cats' })];
    expect(portfolioCheck(cats, { mint: 'c4', sizeUsd: 100, narrative: 'cats', creator: null }, 10000, PP).allowed).toBe(false);
    expect(portfolioCheck(cats, { mint: 'd1', sizeUsd: 100, narrative: 'dogs', creator: null }, 10000, PP).allowed).toBe(true);
    const dev = [pos(1, { creator: 'D' }), pos(2, { creator: 'D' }), pos(3, { creator: 'D' })];
    expect(portfolioCheck(dev, { mint: 'z', sizeUsd: 100, narrative: null, creator: 'D' }, 10000, PP).reasons[0]).toMatch(/dev wallet/);
    const r = portfolioCheck([pos(1, { sizeUsd: 5900 })], { mint: 'q', sizeUsd: 500, narrative: null, creator: null }, 10000, PP);
    expect(r).toMatchObject({ allowed: true, maxSizeUsd: 100 });
    expect(portfolioCheck([pos(1, { sizeUsd: 6000 })], { mint: 'q', sizeUsd: 500, narrative: null, creator: null }, 10000, PP).allowed).toBe(false);
  });
  it('buckets narratives', () => {
    expect(narrativeOf('POPCAT', 'Popcat')).toBe('cats');
    expect(narrativeOf('WIF', 'dogwifhat')).toBe('dogs');
    expect(narrativeOf('PEPE2')).toBe('frogs');
    expect(narrativeOf('XYZ', 'Something')).toBeNull();
  });
  it('monitors positions concurrently', async () => {
    let live = 0, peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 8, async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; });
    expect(peak).toBe(8);
  });
});

describe('market-cap presets and filters', () => {
  it('defaults to BALANCED and 20 positions / 60% exposure / 3s polling', () => {
    const c = buildConfig({});
    expect(c.mcapPreset).toBe('BALANCED');
    expect([c.minMarketCap, c.maxMarketCap]).toEqual([250_000, 5_000_000]);
    expect(c.maxOpenPositions).toBe(20);
    expect(c.maxTotalExposurePct).toBe(60);
    expect(c.positionMonitorSeconds).toBe(3);
    expect(c.minLiquidityUsd).toBe(50000);
    expect(c.minTokenAgeHours).toBe(6);
    expect(c.minVolumeMcapRatio).toBe(0.2);
    expect(c.maxTop10HolderPct).toBe(30);
    expect(c.secMaxLiquidityShare).toBe(0.02);
    expect(c.preset).toBe('CONSERVATIVE_EARNER');
    expect(c.tiers.at(-1)?.multiplier).toBe(3.0);
    expect(c.geminiModel).toBe('gemini-2.5-flash');
    expect(buildConfig({ MCAP_PRESET: 'degen' }).maxMarketCap).toBe(500_000);
    expect(buildConfig({ MCAP_PRESET: 'SAFER' }).minMarketCap).toBe(5_000_000);
    expect(buildConfig({ MAX_OPEN_POSITIONS: '7' }).maxOpenPositions).toBe(7);
    expect(parseMcapPreset('nope')).toBe('BALANCED');
    expect(Object.keys(MCAP_PRESETS)).toEqual(['DEGEN', 'BALANCED', 'SAFER']);
  });
  it('rejects thin pools, low vol/mcap and young tokens', () => {
    const now = Date.now();
    const pair = (o: { mcap: number; v: number; liq: number; ageH: number }) => ({ chainId: 'solana', pairAddress: 'p', baseToken: { address: `m${Math.random()}`, symbol: 'T', name: 'T' }, priceUsd: '1', marketCap: o.mcap, volume: { h24: o.v, m5: 3000 }, liquidity: { usd: o.liq }, pairCreatedAt: now - o.ageH * 3600_000, priceChange: { h1: 1 } });
    const f = { ...buildConfig({}) };
    const w = Object.fromEntries(Object.keys(f.initialWeights).map((k) => [k, 0.125])) as never;
    const [ok, thin, lowVol, young] = [
      pair({ mcap: 1e6, v: 3e5, liq: 1e5, ageH: 10 }), pair({ mcap: 1e6, v: 3e5, liq: 2e4, ageH: 10 }),
      pair({ mcap: 1e6, v: 1e5, liq: 1e5, ageH: 10 }), pair({ mcap: 1e6, v: 3e5, liq: 1e5, ageH: 2 }),
    ].map((p) => rankCandidates([p as never], f, w, now)[0]);
    expect(ok.rejected).toBeUndefined();
    expect(thin.rejected).toMatch(/liquidity/);
    expect(lowVol.rejected).toMatch(/20% of mcap/);
    expect(young.rejected).toMatch(/younger than 6h/);
  });
});

import { generate, activeGeminiModel } from '@/lib/brain/gemini';
import { concentrationFrom } from '@/lib/helius';
import { evaluateAudit } from '@/lib/audit';

describe('Gemini retired-model fallback', () => {
  it('falls through 404 to the next configured model and remembers it', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url.split('/models/')[1].split(':')[0]);
      if (url.includes('gemini-2.5-flash:')) return new Response('{"error":{"code":404}}', { status: 404 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }), { status: 200 });
    }) as never;
    const r = await generate({ apiKey: 'k', model: 'gemini-2.5-flash', contents: [{ role: 'user', parts: [{ text: 'x' }] }], fetchImpl });
    expect(r.text).toBe('hi');
    expect(r.model).toBe('gemini-3.5-flash');
    expect(seen).toEqual(['gemini-2.5-flash', 'gemini-3.5-flash']);
    expect(activeGeminiModel('gemini-2.5-flash')).toBe('gemini-3.5-flash');
  });
  it('does not fall through on 429', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 429 })) as never;
    await expect(generate({ apiKey: 'k', model: 'other-model', contents: [], fetchImpl })).rejects.toThrow(/429/);
  });
});

describe('Helius on-chain holder concentration', () => {
  it('excludes PDA owners (pools, lockers) and aggregates per owner', () => {
    const r = concentrationFrom([
      { owner: 'POOL', amount: 500, ownerIsPda: true },
      { owner: 'A', amount: 100, ownerIsPda: false },
      { owner: 'A', amount: 50, ownerIsPda: false },
      { owner: 'B', amount: 50, ownerIsPda: false },
    ], 1000, 4200);
    expect(r).toEqual({ top1Pct: 15, top10Pct: 20, holders: 4200, excludedPdas: 1 });
  });
  it('on-chain data overrides RugCheck holders in the audit', () => {
    const P = { maxHolderConcentration: 0.3, requireLiquidityLock: false, minLpLockedPct: 0, maxAuditRiskScore: 100, maxSellPriceImpactPct: 25, maxTop10HolderPct: 30 };
    const rep = { topHolders: [{ address: 'x', pct: 1 }] };
    const a = evaluateAudit(rep, { routeFound: true, priceImpactPct: 1 }, P, { top1Pct: 12, top10Pct: 45, holders: 900 });
    const t10 = a.checks.find((c) => c.name === 'top10_concentration')!;
    expect(t10.passed).toBe(false);
    expect(t10.detail).toMatch(/Helius/);
    expect(evaluateAudit(rep, { routeFound: true, priceImpactPct: 1 }, P).checks.find((c) => c.name === 'top10_concentration')!.passed).toBe(true);
  });
});
