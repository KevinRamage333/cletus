import { prisma } from '../db';
import { getConfig } from '../config';
import { TOOL_DECLARATIONS, runTool, selfSnapshot, type ToolContext, type ToolDecl } from './tools';
import { buildSystemInstruction } from './persona';
import { chatWithTools, generate, toContents, activeGeminiModel } from './gemini';
import { mockBrainAnswer, detectIntent } from './mock';
import { providerOrder, withFallback, type Provider } from '../providers';
import { xaiChat } from './xai-chat';
import { xaiConfig } from '../xai';

export const isActionRequest = (q: string) => detectIntent(q) === 'execute';

export function geminiKey(): string | null {
  const c = getConfig();
  return c.enableAiBrain && c.hasGeminiKey && process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY : null;
}

const SEARCH_TOOL: ToolDecl = {
  name: 'search_web',
  description: 'Search the live web (Google Search grounding) for current events, prices, or facts not in your own state or the briefing. Returns a grounded summary with sources.',
  parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'what to search for' } }, required: ['query'] },
};

export async function groundedSearch(query: string, key: string): Promise<{ summary: string; sources: Array<{ title?: string; uri?: string }> }> {
  const r = await generate({ apiKey: key, model: getConfig().geminiModel, googleSearch: true, temperature: 0.2, maxOutputTokens: 700, contents: [{ role: 'user', parts: [{ text: `Search the web and summarise concisely, with dates: ${query}` }] }] });
  return { summary: r.text, sources: r.grounding.slice(0, 6) };
}

export async function latestBriefingText(): Promise<string | null> {
  const b = await prisma.briefing.findFirst({ orderBy: { createdAt: 'desc' } });
  return b ? `(${b.createdAt.toISOString()}, ${b.source})\n${b.content}` : null;
}

async function latestJournalText(accountId: string): Promise<string | null> {
  const j = await prisma.journalEntry.findMany({ where: { OR: [{ accountId }, { accountId: null }] }, orderBy: { createdAt: 'desc' }, take: 3 });
  return j.length ? j.map((x) => `- [${x.kind} ${x.createdAt.toISOString()}] ${x.title}: ${x.content.slice(0, 400)}`).join('\n') : null;
}

export interface BrainReply { conversationId: string; answer: string; source: 'gemini' | 'gemini-grounded' | 'xai' | 'xai-web' | 'mock'; provider?: Provider; model?: string; tools: string[]; sources: Array<{ title?: string; uri?: string; url?: string }>; refused?: string; error?: string }

export async function brainChat(opts: { userId: string; accountId: string; isAdmin: boolean; message: string; conversationId?: string | null }): Promise<BrainReply> {
  let conv = opts.conversationId ? await prisma.conversation.findFirst({ where: { id: opts.conversationId, userId: opts.userId } }) : null;
  if (!conv) conv = await prisma.conversation.create({ data: { userId: opts.userId, title: opts.message.slice(0, 60) } });
  const history = (await prisma.chatMessage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' }, take: 30 })).reverse();
  await prisma.chatMessage.create({ data: { conversationId: conv.id, role: 'user', content: opts.message } });

  const ctx: ToolContext = { userId: opts.userId, accountId: opts.accountId, isAdmin: opts.isAdmin };
  const key = geminiKey();
  const xaiKey = getConfig().enableAiBrain ? xaiConfig().key : null;
  const refused = isActionRequest(opts.message) ? 'execute' : undefined;
  // Single switch: BRAIN_PROVIDER=gemini (default) | xai | mock. Fallback chain: preferred -> other -> mock.
  const order = providerOrder({ BRAIN_PROVIDER: process.env.BRAIN_PROVIDER, hasGeminiKey: Boolean(key), hasXaiKey: Boolean(xaiKey), enableAiBrain: getConfig().enableAiBrain });
  let system: string | null = null;
  const getSystem = async () => (system ??= buildSystemInstruction({ snapshot: await selfSnapshot(ctx), briefing: await latestBriefingText(), journal: await latestJournalText(opts.accountId) }));
  const { provider, result, errors } = await withFallback(order, async (p): Promise<Omit<BrainReply, 'conversationId'>> => {
    if (p === 'gemini' && key) {
      const sources: BrainReply['sources'] = [];
      const r = await chatWithTools({
        apiKey: key, model: getConfig().geminiModel, system: await getSystem(), functions: [...TOOL_DECLARATIONS, SEARCH_TOOL],
        contents: [...toContents(history), { role: 'user', parts: [{ text: opts.message }] }],
        runTool: async (name, args) => {
          if (name !== 'search_web') return runTool(name, args, ctx);
          const g = await groundedSearch(String(args.query ?? ''), key);
          sources.push(...g.sources.map((x) => ({ ...x, url: x.uri })));
          return g;
        },
      });
      return { answer: r.text, source: sources.length ? 'gemini-grounded' : 'gemini', model: activeGeminiModel(getConfig().geminiModel), tools: r.trace.map((t) => t.name), sources };
    }
    if (p === 'xai' && xaiKey) {
      const r = await xaiChat({ system: await getSystem(), history, message: opts.message, decls: TOOL_DECLARATIONS, runTool: (name, args) => runTool(name, args, ctx) });
      return { answer: r.text, source: r.sources.length ? 'xai-web' : 'xai', model: r.model, tools: r.tools, sources: r.sources };
    }
    const m = await mockBrainAnswer(opts.message, (n, a) => runTool(n, a, ctx), history);
    return { answer: m.text, source: 'mock', tools: m.tools, sources: [] };
  });
  const reply: Omit<BrainReply, 'conversationId'> = { ...result, provider };
  if (errors.length) reply.error = errors.map((e) => `${e.provider}: ${e.error}`).join('; ');
  if (refused) reply.refused = refused;
  await prisma.chatMessage.create({ data: { conversationId: conv.id, role: 'model', content: reply.answer, meta: JSON.stringify({ source: reply.source, model: reply.model, tools: reply.tools, sources: reply.sources, refused: reply.refused, error: reply.error }) } });
  await prisma.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
  return { conversationId: conv.id, ...reply };
}
