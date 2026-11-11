import { describe, it, expect, vi } from 'vitest';
import { detectIntent, mockBrainAnswer } from '@/lib/brain/mock';
import { chatWithTools, toContents, generate, type FetchLike } from '@/lib/brain/gemini';
import { buildSystemInstruction, SYSTEM_PROMPT } from '@/lib/brain/persona';
import { TOOL_DECLARATIONS } from '@/lib/brain/tools';
import { parseFeed, heuristicBriefing } from '@/lib/news';
import { tradeReflection } from '@/lib/journal';

const status = {
  mode: 'simulation', preset: 'NONE', aggression: 'MODERATE', killSwitch: false, killReason: null,
  account: { equity: 10050, cash: 9000, startingBalance: 10000, realizedPnl: 42.5, unrealizedPnl: 7.5, recoveryMode: false, paused: false },
  periodPnl: { day: 42.5, week: 42.5, month: 42.5 }, trades: { closed: 4, wins: 3, winRate: 0.75, open: 1 }, sizingTier: { tier: 1, multiplier: 1 },
  engine: { lastScan: 'scanned 80 pairs' },
};
const fakeTools = async (name: string) => {
  switch (name) {
    case 'get_status': return status;
    case 'get_positions': return [{ symbol: 'FOO', sizeUsd: 500, entryPrice: 0.001, lastPrice: 0.0011, unrealizedPnlPct: 10, compositeScore: 0.7 }];
    case 'get_signal_weights': return [{ signal: 'volumeSpike', weight: 0.2, initialWeight: 0.15, wins: 3, trials: 4, winRate: 0.75 }];
    case 'get_self_healing': return { priorityFeeLamports: 150000, slippageBps: 600, consecutiveFailures: 1, pausedUntil: null, lastError: 'rpc 429', limits: { basePriorityFee: 100000, maxPriorityFee: 2000000, escalation: 1.5, baseSlippageBps: 500, maxSlippageBps: 1000, widenStepBps: 100, maxConsecutiveFailures: 3, pauseMinutes: 15 } };
    case 'get_world_briefing': return { briefing: '**Tone:** mixed', briefingAt: new Date(), briefingSource: 'heuristic', solPriceUsd: 150, solChange24h: -1.2, trending: [] };
    case 'get_journal': return [{ kind: 'trade', title: 'FOO +10%', content: 'Lesson: clean follow-through.', at: new Date() }];
    case 'get_blocks': return [{ at: new Date(), message: 'audit FAILED BAR: honeypot' }];
    default: return [];
  }
};

describe('brain: offline mock (no Gemini key)', () => {
  it('routes intents', () => {
    expect(detectIntent('How is my PnL?')).toBe('pnl');
    expect(detectIntent('what are you doing right now?')).toBe('doing');
    expect(detectIntent('Why did you buy that token?')).toBe('doing');
    expect(detectIntent("why didn't you buy BAR")).toBe('blocks');
    expect(detectIntent('please buy BONK now')).toBe('execute');
    expect(detectIntent("what's happening in the world today?")).toBe('news');
    expect(detectIntent('what did you learn, show me your journal')).toBe('journal');
    expect(detectIntent('explain the greeks for options')).toBe('options');
  });
  it('answers from live self-state via read-only tools', async () => {
    const r = await mockBrainAnswer('how is my pnl?', fakeTools);
    expect(r.tools).toContain('get_status');
    expect(r.text).toContain('$42.50');
    expect(r.text).toMatch(/75%/);
    expect(r.text).toMatch(/Not financial advice/);
  });
  it('is advisory only: refuses to execute trades', async () => {
    const r = await mockBrainAnswer('please buy BONK now', fakeTools);
    expect(r.intent).toBe('execute');
    expect(r.text).toMatch(/advisory only/i);
    expect(r.tools).toEqual([]);
  });
  it('is multi-turn: short follow-ups reuse the previous topic', async () => {
    const r = await mockBrainAnswer('why?', fakeTools, [{ role: 'user', content: 'show me the signal weights' }, { role: 'model', content: '...' }]);
    expect(r.intent).toBe('signals');
    expect(r.text).toMatch(/volumeSpike/);
  });
  it('uses self-healing, news and journal tools', async () => {
    expect((await mockBrainAnswer('what is your priority fee and slippage?', fakeTools)).text).toMatch(/150,000/);
    expect((await mockBrainAnswer('any world news?', fakeTools)).text).toMatch(/SOL: \*\*\$150\.00/);
    expect((await mockBrainAnswer('read me your journal', fakeTools)).text).toMatch(/clean follow-through/);
  });
});

describe('brain: Gemini function calling (mocked fetch)', () => {
  it('runs tools the model requests and returns the final text', async () => {
    const calls: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const responses = [
      { candidates: [{ content: { parts: [{ functionCall: { name: 'get_status', args: {} } }] } }] },
      { candidates: [{ content: { parts: [{ text: 'Equity is $10,050.' }] } }] },
    ];
    const fetchImpl: FetchLike = async (_url, init) => { calls.push(JSON.parse(String(init.body))); return new Response(JSON.stringify(responses.shift())); };
    const runTool = vi.fn(async () => status);
    const r = await chatWithTools({ apiKey: 'k', model: 'gemini-2.5-flash', system: 'sys', functions: TOOL_DECLARATIONS, contents: [{ role: 'user', parts: [{ text: 'equity?' }] }], runTool, fetchImpl });
    expect(r.text).toBe('Equity is $10,050.');
    expect(runTool).toHaveBeenCalledWith('get_status', {});
    expect(r.trace.map((t) => t.name)).toEqual(['get_status']);
    expect(calls[0].tools[0].functionDeclarations.length).toBe(TOOL_DECLARATIONS.length);
    expect(calls[1].contents.at(-1).parts[0].functionResponse.name).toBe('get_status');
    expect(calls[0].systemInstruction.parts[0].text).toBe('sys');
  });
  it('uses the configured model and Google Search grounding when asked', async () => {
    let url = ''; let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const fetchImpl: FetchLike = async (u, init) => { url = u; body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] }, groundingMetadata: { groundingChunks: [{ web: { title: 'Reuters', uri: 'https://x' } }] } }] })); };
    const r = await generate({ apiKey: 'k', model: 'gemini-2.5-flash', googleSearch: true, contents: [{ role: 'user', parts: [{ text: 'news' }] }], fetchImpl });
    expect(url).toContain('/models/gemini-2.5-flash:generateContent');
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(r.grounding[0].uri).toBe('https://x');
  });
  it('maps stored history to alternating Gemini contents', () => {
    const c = toContents([{ role: 'model', content: 'hi' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'model', content: 'c' }]);
    expect(c.map((x) => x.role)).toEqual(['user', 'model']);
    expect(c[0].parts.length).toBe(2);
  });
  it('declares only read-only tools', () => {
    for (const t of TOOL_DECLARATIONS) expect(t.name).toMatch(/^get_/);
  });
});

describe('brain: persona & context', () => {
  it('uses the spec SYSTEM_PROMPT persona plus compliance, self-awareness, briefing and journal', () => {
    expect(SYSTEM_PROMPT).toMatch(/You are Cletus, an AI with master's-degree-level expertise/);
    expect(SYSTEM_PROMPT).not.toMatch(/CLETUS token|profit-share|untaxable bank/i);
    expect(SYSTEM_PROMPT).toMatch(/CORE FOUNDATIONAL SUBJECTS/);
    expect(SYSTEM_PROMPT).toMatch(/Tax Law \(educational only\)/);
    const s = buildSystemInstruction({ snapshot: '{"mode":"simulation"}', briefing: 'BRIEFING-X', journal: 'JOURNAL-Y' });
    expect(s).toMatch(/INTERNAL RISK LIMITS/); expect(s).toMatch(/US SECURITIES & MARKET-CONDUCT KNOWLEDGE/); expect(s).toMatch(/Howey test/); expect(s).toMatch(/CLAIMS POLICY/); expect(s).not.toMatch(/REGULATORY COMPLIANCE|operate under a strict regulatory/);
    expect(s).toMatch(/ADVISORY ONLY/);
    expect(s).toContain('BRIEFING-X');
    expect(s).toContain('JOURNAL-Y');
    expect(s).not.toMatch(/Topic notes for this question/);
    const dcf = buildSystemInstruction({ snapshot: '{}', briefing: null, journal: null, query: 'Walk me through DCF and WACC' });
    expect(dcf).toMatch(/Topic notes for this question/);
    expect(dcf).toMatch(/WACC = /);
    expect(dcf).toMatch(/NPV = /);
  });
});

describe('news module', () => {
  const rss = `<?xml version="1.0"?><rss><channel><item><title>Bitcoin ETF inflows surge</title><link>https://ex.com/a</link><pubDate>Wed, 11 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Big &amp; bold&lt;/p&gt;</description></item><item><title>Exchange hack drains funds</title><link>https://ex.com/b</link></item></channel></rss>`;
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Fed holds rates</title><link rel="alternate" href="https://fed.gov/x"/><updated>2026-11-10T19:00:00Z</updated></entry></feed>`;
  it('parses RSS and Atom', () => {
    const a = parseFeed(rss, { source: 'T', category: 'crypto', url: '' });
    expect(a.length).toBe(2);
    expect(a[0].url).toBe('https://ex.com/a');
    expect(a[0].publishedAt?.toISOString()).toBe('2026-11-10T10:00:00.000Z'.replace('10T', '11T'));
    expect(a[0].summary).toBe('Big & bold');
    const b = parseFeed(atom, { source: 'Fed', category: 'fed', url: '' });
    expect(b[0]).toMatchObject({ title: 'Fed holds rates', url: 'https://fed.gov/x', category: 'fed' });
    expect(parseFeed('not xml <<', { source: 'x', category: 'world', url: '' })).toEqual([]);
  });
  it('builds a heuristic world briefing with tone, SOL and sections', () => {
    const items = parseFeed(rss, { source: 'T', category: 'crypto', url: '' }).concat(parseFeed(atom, { source: 'Fed', category: 'fed', url: '' }));
    const b = heuristicBriefing(items, { solPriceUsd: 150.5, solChange24h: 2, trending: [{ symbol: 'WIF', mint: 'm', priceChangeH1: 3, volume24h: 1, marketCap: 1 }] });
    expect(b).toMatch(/\*\*Tone:\*\*/);
    expect(b).toMatch(/SOL:\*\* \$150\.50/);
    expect(b).toMatch(/WIF/);
    expect(b).toMatch(/\*\*Fed:\*\*/);
    expect(b).toMatch(/decided only by the signal engine/);
  });
});

describe('self-reflection journal', () => {
  it('writes a trade reflection with signals, weight changes and a lesson', () => {
    const p = { symbol: 'FOO', pnlUsd: -12, pnlPct: -10.5, exitReason: 'stop_loss', compositeScore: 0.71, signals: JSON.stringify({ volumeSpike: 0.9, momentum: 0.6, breakout: 0, velocitySurge: 0, microCapHeat: 0.5, nanoCapSpike: 0, liquidityBuild: 0.3, volMcapRatio: 0.2 }), openedAt: new Date(Date.now() - 600000), closedAt: new Date(), highestPrice: 1.05, entryPrice: 1 };
    const before = { volumeSpike: 0.15, momentum: 0.15 } as Record<string, number>;
    const after = { volumeSpike: 0.13, momentum: 0.14 } as Record<string, number>;
    const r = tradeReflection(p, before, after);
    expect(r.title).toMatch(/❌ FOO/);
    expect(r.content).toMatch(/stop_loss/);
    expect(r.content).toMatch(/volumeSpike 90%/);
    expect(r.content).toMatch(/Weights adjusted: volumeSpike -2\.00pp/);
    expect(r.content).toMatch(/Lesson:/);
  });
});
