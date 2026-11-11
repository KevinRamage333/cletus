import { prisma } from '../db';
import { getConfig } from '../config';
import { TOOL_DECLARATIONS, runTool, selfSnapshot, type ToolContext, type ToolDecl } from './tools';
import { buildSystemInstruction } from './persona';
import { chatWithTools, generate, toContents } from './gemini';
import { mockBrainAnswer } from './mock';

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

export interface BrainReply { conversationId: string; answer: string; source: 'gemini' | 'mock'; model?: string; tools: string[]; error?: string }

export async function brainChat(opts: { userId: string; accountId: string; isAdmin: boolean; message: string; conversationId?: string | null }): Promise<BrainReply> {
  let conv = opts.conversationId ? await prisma.conversation.findFirst({ where: { id: opts.conversationId, userId: opts.userId } }) : null;
  if (!conv) conv = await prisma.conversation.create({ data: { userId: opts.userId, title: opts.message.slice(0, 60) } });
  const history = (await prisma.chatMessage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' }, take: 30 })).reverse();
  await prisma.chatMessage.create({ data: { conversationId: conv.id, role: 'user', content: opts.message } });

  const ctx: ToolContext = { userId: opts.userId, accountId: opts.accountId, isAdmin: opts.isAdmin };
  const key = geminiKey();
  let reply: Omit<BrainReply, 'conversationId'>;
  if (key) {
    try {
      const system = buildSystemInstruction({ snapshot: await selfSnapshot(ctx), briefing: await latestBriefingText(), journal: await latestJournalText(opts.accountId) });
      const r = await chatWithTools({
        apiKey: key, model: getConfig().geminiModel, system, functions: [...TOOL_DECLARATIONS, SEARCH_TOOL],
        contents: [...toContents(history), { role: 'user', parts: [{ text: opts.message }] }],
        runTool: async (name, args) => (name === 'search_web' ? groundedSearch(String(args.query ?? ''), key) : runTool(name, args, ctx)),
      });
      reply = { answer: r.text, source: 'gemini', model: getConfig().geminiModel, tools: r.trace.map((t) => t.name) };
    } catch (e) {
      const m = await mockBrainAnswer(opts.message, (n, a) => runTool(n, a, ctx), history);
      reply = { answer: m.text, source: 'mock', tools: m.tools, error: (e as Error).message };
    }
  } else {
    const m = await mockBrainAnswer(opts.message, (n, a) => runTool(n, a, ctx), history);
    reply = { answer: m.text, source: 'mock', tools: m.tools };
  }
  await prisma.chatMessage.create({ data: { conversationId: conv.id, role: 'model', content: reply.answer, meta: JSON.stringify({ source: reply.source, model: reply.model, tools: reply.tools, error: reply.error }) } });
  await prisma.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
  return { conversationId: conv.id, ...reply };
}
