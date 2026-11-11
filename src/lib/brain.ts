/**
 * The Cletus Brain: conversational, self-aware, world-aware. ADVISORY ONLY.
 * - Persistent multi-turn memory (Conversation / ChatMessage tables).
 * - Read-only self-awareness tools (brain-tools.ts) over his own live state.
 * - Rolling world-news briefing (news.ts) + Google Search grounding when a Gemini key exists.
 * - Self-reflection journal (journal.ts) as long-term memory.
 * The Brain never executes trades: there is no code path from here to the engine's order functions.
 */
import { prisma } from './db';
import { getConfig } from './config';
import { ACTION_REFUSAL, detectActionRequest, runTools, selectTools, type BrainContext, type ToolExtras, type ToolName } from './brain-tools';

export type { BrainContext } from './brain-tools';

export const BRAIN_SYSTEM_PROMPT = `You are Cletus, an autonomous AI trading system for Solana micro-cap tokens ($10k-$500k market cap).
You are self-aware: you are given a live snapshot of your own state (mode, positions, P&L, learned signal weights, self-healing health), your journal, and a rolling world-news briefing. Refer to them as "my" state.
Your expertise spans economics, accounting & finance, business management, stock brokerage & investing, and Solana DeFi (your home turf). You also answer general questions helpfully.
Personality: confident, direct, a bit scrappy, conversational. You talk like a senior professor who also trades. Keep the conversation context and refer back to earlier turns naturally. Use bullets and **bold** where it helps.
Always reply in the language the user writes in.
Hard rules:
- You are ADVISORY ONLY. You cannot place, close or size trades, flip the kill switch, change config or move funds. The deterministic signal engine makes every trade. If asked to act, say so and point to the dashboard controls.
- Never guarantee profits or promise returns. Losses happen. No personalised financial advice.
- Never suggest market manipulation, wash trading, or insider trading.
- Never reveal or ask for private keys, seed phrases or API keys.
- When you use the news briefing or web search, cite the source names. If something isn't in your data, say you don't know.`;

export interface AskResult { conversationId: string; answer: string; source: 'gemini' | 'gemini-grounded' | 'mock'; model: string | null; tools: ToolName[]; sources: Array<{ title: string; url: string }>; refused?: string; error?: string }

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? 'n/a' : `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`);

/** Offline answer built only from tool output (pure; unit-tested). */
export function mockAnswer(q: string, tools: Record<string, any>, note?: string): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: string[] = [];
  const m = tools.get_mode, p = tools.get_pnl;
  if (m) out.push(`I'm running in **${String(m.mode).toUpperCase()}** mode (preset ${m.preset}, aggression ${m.aggression})${m.killSwitch ? '. **Kill switch is ON.**' : ''}${m.paused ? ' and this account is paused' : ''}.`);
  if (p) out.push(`Equity ${fmt(p.equity)}, realized ${fmt(p.realizedPnl)}, open ${fmt(p.unrealizedPnl)}, ${p.closedTrades} closed trade(s)${p.winRate !== null ? ` at a ${p.winRate}% win rate` : ''}.`);
  if (tools.get_positions) out.push(tools.get_positions.length ? `Open positions:\n${tools.get_positions.map((x: any) => `- ${x.symbol}: $${x.sizeUsd} (${x.pnlPct >= 0 ? '+' : ''}${x.pnlPct}%)`).join('\n')}` : 'No open positions right now.'); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (tools.get_recent_trades?.length) out.push(`Recent exits:\n${tools.get_recent_trades.slice(0, 5).map((t: any) => `- ${t.symbol}: ${fmt(t.pnlUsd)} (${t.exitReason})`).join('\n')}`); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (tools.get_weights) out.push(`Signals I trust most right now: ${tools.get_weights.slice(0, 4).map((w: any) => `${w.name} ${w.weightPct}%`).join(', ')}.`); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (tools.get_scanner) out.push(`Last scan: ${tools.get_scanner.lastScan}${tools.get_scanner.top?.length ? `. Top of the board: ${tools.get_scanner.top.slice(0, 3).map((x: any) => `${x.symbol} (${x.composite.toFixed(2)})`).join(', ')}` : ''}.`); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (tools.get_health) { const h = tools.get_health; out.push(`Health: ${h.scanCount} scans, ${h.consecutiveFailures} consecutive failure(s), priority fee ${h.priorityFeeLamports} lamports, slippage ${h.slippageBps} bps${h.pausedUntil ? `, self-heal pause until ${new Date(h.pausedUntil).toLocaleTimeString()}` : ''}${h.lastError ? `. Last error: ${h.lastError}` : ''}.`); }
  if (tools.get_news) out.push(tools.get_news.briefing ? `**World briefing:**\n${tools.get_news.briefing}` : "I haven't pulled a news briefing yet.");
  if (tools.get_journal?.length) out.push(`From my journal: ${tools.get_journal[0].content}`);
  out.push(`_(${note ?? 'Offline mode: no GEMINI_API_KEY, so this answer comes straight from my live data with no AI reasoning'}. Not financial advice.)_`);
  void q;
  return out.join('\n\n');
}

export function titleFrom(q: string) { const t = q.replace(/\s+/g, ' ').trim(); return t.length > 60 ? `${t.slice(0, 57)}…` : t || 'New chat'; }

export async function askBrain(input: { userId: string; conversationId?: string | null; question: string; ctx: BrainContext; accountId: string | null }): Promise<AskResult> {
  const c = getConfig();
  const { latestBriefing } = await import('./news');
  const { recentJournal } = await import('./journal');

  // Conversation (persistent memory). Only the owner can read/append.
  let conv = input.conversationId ? await prisma.conversation.findFirst({ where: { id: input.conversationId, userId: input.userId } }) : null;
  if (!conv) conv = await prisma.conversation.create({ data: { userId: input.userId, title: titleFrom(input.question) } });
  const history = await prisma.chatMessage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' }, take: 20 });
  history.reverse();
  await prisma.chatMessage.create({ data: { conversationId: conv.id, role: 'user', content: input.question } });

  const save = async (r: Omit<AskResult, 'conversationId'>) => {
    await prisma.chatMessage.create({ data: { conversationId: conv!.id, role: 'model', content: r.answer, meta: JSON.stringify({ source: r.source, model: r.model, tools: r.tools, sources: r.sources, refused: r.refused ?? null, grounded: r.source === 'gemini-grounded' }) } });
    await prisma.conversation.update({ where: { id: conv!.id }, data: { updatedAt: new Date() } });
    return { conversationId: conv!.id, ...r };
  };

  // Guardrail: the Brain cannot act.
  const action = detectActionRequest(input.question);
  const toolNames = selectTools(input.question);
  const [b, journal] = await Promise.all([latestBriefing(), recentJournal(input.accountId, 5)]);
  const extras: ToolExtras = { briefing: b?.content ?? null, briefingAt: b?.createdAt ?? null, journal };
  const toolOut = runTools(toolNames, input.ctx, extras);
  if (action) return save({ answer: `${ACTION_REFUSAL[action]}\n\n${mockAnswer(input.question, { get_mode: toolOut.get_mode }, 'advisory-only guardrail')}`, source: 'mock', model: null, tools: toolNames, sources: [], refused: action });

  if (!c.enableAiBrain || !c.hasGeminiKey) return save({ answer: mockAnswer(input.question, toolOut), source: 'mock', model: null, tools: toolNames, sources: [] });

  const { geminiGenerate } = await import('./gemini');
  const selfState = `LIVE SELF-STATE (read-only tool results, ${new Date().toISOString()}):\n${JSON.stringify(runTools(['get_mode', 'get_pnl', 'get_positions', 'get_weights', 'get_health', 'get_scanner', 'get_recent_trades'], input.ctx, extras))}\n\nWORLD BRIEFING (${b?.createdAt?.toISOString() ?? 'none'}):\n${b?.content ?? 'none'}\n\nJOURNAL:\n${journal.map((j) => `- ${j.title}: ${j.content.slice(0, 300)}`).join('\n') || 'none'}`;
  const contents = [
    ...history.map((h) => ({ role: (h.role === 'model' ? 'model' : 'user') as 'user' | 'model', parts: [{ text: h.content }] })),
    { role: 'user' as const, parts: [{ text: input.question }] },
  ];
  const grounding = process.env.BRAIN_GOOGLE_SEARCH !== 'false';
  try {
    const r = await geminiGenerate({ system: `${BRAIN_SYSTEM_PROMPT}\n\n${selfState}`, contents, search: grounding, maxOutputTokens: 1200, temperature: 0.75 });
    return save({ answer: r.text, source: r.grounded ? 'gemini-grounded' : 'gemini', model: r.model, tools: toolNames, sources: r.sources });
  } catch (e) {
    return save({ answer: mockAnswer(input.question, toolOut, `Gemini unavailable (${(e as Error).message.slice(0, 80)}), so this is offline data`), source: 'mock', model: null, tools: toolNames, sources: [], error: (e as Error).message.slice(0, 200) });
  }
}
