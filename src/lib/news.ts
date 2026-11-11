/**
 * World-events module: public RSS feeds + Solana market context on a schedule,
 * stored in the DB, condensed into a rolling "world briefing" for the Brain.
 */
import { XMLParser } from 'fast-xml-parser';
import { prisma } from './db';
import { getConfig } from './config';
import { log } from './logger';
import { fetchPairsForMints } from './dexscreener';
import { generate } from './brain/gemini';
import { SYSTEM_PROMPT } from './brain/persona';
import { providerOrder } from './providers';

/** Should we spend an AI call on a new briefing? (pure; unit-tested) */
export function shouldResummarise(o: { lastAiAt: Date | null; newItems: number; now: Date; cacheMinutes: number; minNewItems: number }): boolean {
  if (!o.lastAiAt) return true;
  const ageMin = (o.now.getTime() - o.lastAiAt.getTime()) / 60_000;
  if (ageMin >= o.cacheMinutes) return true;
  return o.newItems >= o.minNewItems && ageMin >= Math.min(15, o.cacheMinutes);
}

export type NewsCategory = 'crypto' | 'macro' | 'world' | 'fed';
export interface Feed { source: string; category: NewsCategory; url: string }
export interface ParsedItem { source: string; category: NewsCategory; title: string; url: string; summary: string | null; publishedAt: Date | null }

const gnews = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

export const FEEDS: Feed[] = [
  { source: 'CoinDesk', category: 'crypto', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { source: 'Cointelegraph', category: 'crypto', url: 'https://cointelegraph.com/rss' },
  { source: 'Decrypt', category: 'crypto', url: 'https://decrypt.co/feed' },
  // Reuters and AP no longer publish public RSS; Google News RSS scoped to their domains is used instead.
  { source: 'Reuters Business', category: 'macro', url: gnews('site:reuters.com business when:2d') },
  { source: 'AP Business', category: 'macro', url: gnews('site:apnews.com business when:2d') },
  { source: 'Reuters World', category: 'world', url: gnews('site:reuters.com world when:2d') },
  { source: 'AP World', category: 'world', url: gnews('site:apnews.com world when:2d') },
  { source: 'Federal Reserve', category: 'fed', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true, htmlEntities: true });
const txt = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'object' ? String((v as Record<string, unknown>)['#text'] ?? '') : String(v));
const strip = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Parse RSS 2.0 or Atom into items (pure; unit-tested). */
export function parseFeed(xml: string, feed: Feed, max = 25): ParsedItem[] {
  let doc: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { doc = parser.parse(xml); } catch { return []; }
  const rssItems = doc?.rss?.channel?.item ?? doc?.['rdf:RDF']?.item;
  const atomItems = doc?.feed?.entry;
  const raw = ([] as unknown[]).concat(rssItems ?? atomItems ?? []).slice(0, max) as Array<Record<string, unknown>>;
  const out: ParsedItem[] = [];
  for (const it of raw) {
    const title = strip(txt(it.title));
    let url = txt(it.link);
    if (!url && it.link && typeof it.link === 'object') {
      const l = ([] as Array<Record<string, string>>).concat(it.link as Record<string, string>);
      url = l.find((x) => !x['@_rel'] || x['@_rel'] === 'alternate')?.['@_href'] ?? l[0]?.['@_href'] ?? '';
    }
    if (!url) url = txt(it.guid);
    if (!title || !url) continue;
    const dateStr = txt(it.pubDate) || txt(it.published) || txt(it.updated) || txt(it['dc:date']);
    const d = dateStr ? new Date(dateStr) : null;
    const desc = strip(txt(it.description) || txt(it.summary) || txt(it['content:encoded'])).slice(0, 400) || null;
    out.push({ source: feed.source, category: feed.category, title: title.slice(0, 300), url: url.trim(), summary: desc, publishedAt: d && !isNaN(d.getTime()) ? d : null });
  }
  return out;
}

async function fetchFeed(f: Feed): Promise<ParsedItem[]> {
  const res = await fetch(f.url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; CletusBot/0.2; +local)', accept: 'application/rss+xml, application/xml, text/xml' }, redirect: 'follow', signal: AbortSignal.timeout(12000), cache: 'no-store' });
  if (!res.ok) throw new Error(`${f.source} HTTP ${res.status}`);
  return parseFeed(await res.text(), f);
}

export interface MarketContext { solPriceUsd: number | null; solChange24h: number | null; trending: Array<{ symbol: string; mint: string; priceChangeH1: number; volume24h: number; marketCap: number }> }

export async function fetchMarketContext(): Promise<MarketContext> {
  let solPriceUsd: number | null = null, solChange24h: number | null = null;
  try {
    const { jupFetch, JUP_PRICE_BASE } = await import('./jupiter');
    const r = await jupFetch(`${JUP_PRICE_BASE()}?ids=So11111111111111111111111111111111111111112`, { maxWaitMs: 8000, timeoutMs: 8000 });
    const j = await r.json();
    const s = j['So11111111111111111111111111111111111111112'];
    solPriceUsd = s?.usdPrice ?? null;
    solChange24h = s?.priceChange24h ?? null;
  } catch { /* ignore */ }
  let trending: MarketContext['trending'] = [];
  try {
    const r = await fetch('https://api.dexscreener.com/token-boosts/top/v1', { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const boosts = (await r.json()) as Array<{ chainId: string; tokenAddress: string }>;
    const mints = [...new Set(boosts.filter((b) => b.chainId === 'solana').map((b) => b.tokenAddress))].slice(0, 15);
    const pairs = await fetchPairsForMints(mints);
    trending = [...pairs.values()].map((p) => ({ symbol: p.baseToken.symbol, mint: p.baseToken.address, priceChangeH1: p.priceChange?.h1 ?? 0, volume24h: Math.round(p.volume?.h24 ?? 0), marketCap: Math.round(p.marketCap ?? p.fdv ?? 0) }))
      .sort((a, b) => b.volume24h - a.volume24h).slice(0, 10);
  } catch { /* ignore */ }
  return { solPriceUsd, solChange24h, trending };
}

const RISK_OFF = /\b(hack|exploit|crash|plunge|selloff|sell-off|lawsuit|sues|charged|ban|sanction|war|attack|tariff|default|recession|liquidat|outflow|fraud|collapse|downgrade|layoff|inflation (rises|jumps|hotter))/i;
const RISK_ON = /\b(rally|surge|soar|record high|inflow|approv|etf|rate cut|cuts rates|easing|adoption|partnership|upgrade|beats|growth)/i;

/** Deterministic briefing used without a Gemini key (pure; unit-tested). */
export function heuristicBriefing(items: Array<{ source: string; category: string; title: string; publishedAt: Date | null }>, m: MarketContext): string {
  const by = (c: NewsCategory) => items.filter((i) => i.category === c).slice(0, 4);
  const on = items.filter((i) => RISK_ON.test(i.title)).length;
  const off = items.filter((i) => RISK_OFF.test(i.title)).length;
  const tone = off > on * 1.3 ? 'risk-off' : on > off * 1.3 ? 'risk-on' : 'mixed';
  const lines: string[] = [];
  lines.push(`**Tone:** ${tone} (headline keywords: ${on} risk-on vs ${off} risk-off across ${items.length} stories).`);
  if (m.solPriceUsd) lines.push(`**SOL:** $${m.solPriceUsd.toFixed(2)}${m.solChange24h !== null ? ` (${m.solChange24h >= 0 ? '+' : ''}${m.solChange24h.toFixed(2)}% 24h)` : ''}.`);
  if (m.trending.length) lines.push(`**DexScreener trending (Solana):** ${m.trending.slice(0, 6).map((t) => `${t.symbol} (${t.priceChangeH1 >= 0 ? '+' : ''}${t.priceChangeH1}% 1h)`).join(', ')}.`);
  const sec = (label: string, c: NewsCategory) => { const x = by(c); if (x.length) lines.push(`**${label}:**\n${x.map((i) => `- ${i.title} — _${i.source}_`).join('\n')}`); };
  sec('Crypto', 'crypto'); sec('Fed', 'fed'); sec('Macro / business', 'macro'); sec('World', 'world');
  lines.push(`**What it means for me:** ${tone === 'risk-off' ? 'risk-off headlines tend to drain micro-cap liquidity — expect more audit/compliance blocks and tighter exits.' : tone === 'risk-on' ? 'risk-on flow can lift micro-cap volume — my volume and momentum signals may fire more, but pumps reverse fast.' : 'no clear macro push; micro-caps trade on their own flow.'} My entries are still decided only by the signal engine.`);
  return lines.join('\n\n');
}

let refreshing = false;

export async function refreshNewsAndBriefing(): Promise<{ newItems: number; feedsOk: number; briefingSource: string }> {
  if (refreshing) return { newItems: 0, feedsOk: 0, briefingSource: 'busy' };
  refreshing = true;
  try {
    const results = await Promise.allSettled(FEEDS.map(fetchFeed));
    const items: ParsedItem[] = [];
    let feedsOk = 0;
    results.forEach((r, i) => { if (r.status === 'fulfilled') { feedsOk++; items.push(...r.value); } else void log('warn', `news feed failed: ${FEEDS[i].source}: ${r.reason?.message ?? r.reason}`); });
    const urls = items.map((i) => i.url);
    const existing = new Set((await prisma.newsItem.findMany({ where: { url: { in: urls } }, select: { url: true } })).map((x) => x.url));
    const fresh = items.filter((i, idx) => !existing.has(i.url) && urls.indexOf(i.url) === idx);
    if (fresh.length) await prisma.newsItem.createMany({ data: fresh });
    await prisma.newsItem.deleteMany({ where: { fetchedAt: { lt: new Date(Date.now() - 7 * 86400_000) } } });

    const market = await fetchMarketContext();
    await prisma.marketSnapshot.create({ data: { solPriceUsd: market.solPriceUsd, solChange24h: market.solChange24h, trending: JSON.stringify(market.trending) } });

    const recent = await prisma.newsItem.findMany({ where: { OR: [{ publishedAt: { gte: new Date(Date.now() - 36 * 3600_000) } }, { publishedAt: null }] }, orderBy: { publishedAt: 'desc' }, take: 60 });
    let content = heuristicBriefing(recent, market);
    let source = 'heuristic';
    let sources: unknown[] = [];
    const c = getConfig();
    const key = c.enableAiBrain && c.hasGeminiKey ? process.env.GEMINI_API_KEY : null;
    const xaiKey = c.enableAiBrain && process.env.XAI_API_KEY ? process.env.XAI_API_KEY : null;
    // Free-tier friendly: reuse the last AI summary unless it is stale or enough new headlines arrived.
    const lastAi = await prisma.briefing.findFirst({ where: { source: { not: 'heuristic' } }, orderBy: { createdAt: 'desc' } });
    const reuse = lastAi && !shouldResummarise({ lastAiAt: lastAi.createdAt, newItems: fresh.length, now: new Date(), cacheMinutes: Number(process.env.NEWS_SUMMARY_CACHE_MINUTES ?? 60), minNewItems: Number(process.env.NEWS_SUMMARY_MIN_NEW_ITEMS ?? 8) });
    if (reuse && lastAi) {
      await log('debug', 'briefing: reusing cached AI summary (free-tier cache)');
      return { newItems: fresh.length, feedsOk, briefingSource: `${lastAi.source} (cached)` };
    }
    const order = providerOrder({ BRAIN_PROVIDER: process.env.BRAIN_PROVIDER, hasGeminiKey: Boolean(key), hasXaiKey: Boolean(xaiKey) }).filter((p) => p !== 'mock');
    for (const prov of order) {
      if (source !== 'heuristic') break;
      if (prov === 'xai') {
        try {
          const { xaiWebSearch } = await import('./xai');
          const headlines = recent.slice(0, 30).map((i) => `- [${i.category}] ${i.title} (${i.source})`).join('\n');
          const r = await xaiWebSearch(`Write my world briefing for today. RSS headlines for reference:\n${headlines}`, `${SYSTEM_PROMPT}\n\nYou are writing your own internal "world briefing": a concise (<= 250 words) markdown digest of what matters for Solana micro-cap trading risk today. Sections: Tone, Crypto, Fed & macro, World, What it means for me. Use web search for the latest facts. No price predictions, no advice.`);
          content = r.text; source = 'xai-web'; sources = r.sources.slice(0, 8);
        } catch (e) { await log('warn', `briefing: xAI failed (${(e as Error).message})`); }
        continue;
      }
    if (key) {
      try {
        const headlines = recent.slice(0, 40).map((i) => `- [${i.category}] ${i.title} (${i.source}${i.publishedAt ? `, ${i.publishedAt.toISOString()}` : ''})`).join('\n');
        const r = await generate({
          apiKey: key, model: c.geminiModel, googleSearch: true, temperature: 0.3, maxOutputTokens: 900,
          system: `${SYSTEM_PROMPT}\n\nYou are writing your own internal "world briefing": a concise (<= 250 words) markdown digest of what matters for Solana micro-cap trading risk today. Sections: Tone, Crypto, Fed & macro, World, What it means for me. No price predictions, no advice.`,
          contents: [{ role: 'user', parts: [{ text: `Market: SOL ${market.solPriceUsd ?? 'n/a'} USD (${market.solChange24h ?? 'n/a'}% 24h). Trending on DexScreener: ${market.trending.map((t) => t.symbol).join(', ')}.\n\nHeadlines:\n${headlines}\n\nUse Google Search to verify and fill in anything major that is missing.` }] }],
        });
        if (r.text) { content = r.text; source = r.grounding.length ? 'gemini-grounded' : 'gemini'; sources = r.grounding.slice(0, 8); }
      } catch (e) {
        await log('warn', `briefing: Gemini failed, using heuristic (${(e as Error).message})`);
      }
    }
    }
    await prisma.briefing.create({ data: { content, source, itemsCount: recent.length, sources: JSON.stringify(sources) } });
    await log('info', `news refresh: ${feedsOk}/${FEEDS.length} feeds ok, ${fresh.length} new items, briefing via ${source}`);
    return { newItems: fresh.length, feedsOk, briefingSource: source };
  } finally {
    refreshing = false;
  }
}
