/**
 * xAI Grok chat path: OpenAI-compatible streaming chat completions with function calling
 * over the same READ-ONLY self-awareness tools Gemini uses, plus a `search_web` tool backed
 * by xAI's server-side web_search (Responses API). Nothing here can execute a trade.
 */
import type { ToolDecl } from './tools';
import { xaiChatStream, xaiWebSearch, xaiConfig, type ChatMsg, type FnTool } from '../xai';

type GSchema = { type?: string; properties?: Record<string, GSchema>; items?: GSchema; required?: string[]; description?: string; enum?: string[] };

/** Gemini-style schema (OBJECT/STRING…) to JSON Schema (pure; unit-tested). */
export function toJsonSchema(s: GSchema | undefined): Record<string, unknown> {
  if (!s) return { type: 'object', properties: {} };
  const out: Record<string, unknown> = { type: (s.type ?? 'object').toLowerCase() };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)]));
  if (s.items) out.items = toJsonSchema(s.items);
  if (s.required) out.required = s.required;
  return out;
}

export function toFnTools(decls: ToolDecl[]): FnTool[] {
  return decls.map((d) => ({ type: 'function', function: { name: d.name, description: `READ-ONLY. ${d.description}`, parameters: toJsonSchema(d.parameters as GSchema | undefined) } }));
}

export async function xaiChat(o: {
  system: string; history: Array<{ role: string; content: string }>; message: string; decls: ToolDecl[];
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>; onDelta?: (s: string) => void; maxSteps?: number;
}): Promise<{ text: string; model: string; tools: string[]; sources: Array<{ title?: string; url?: string; uri?: string }> }> {
  const searchDecl: ToolDecl = { name: 'search_web', description: 'Search the live web (xAI web search) for current events, prices, or facts not in your own state or the briefing.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'what to search for' } }, required: ['query'] } as never };
  const decls = xaiConfig().webSearch ? [...o.decls, searchDecl] : o.decls;
  const allowed = new Set(decls.map((d) => d.name));
  const messages: ChatMsg[] = [
    { role: 'system', content: o.system },
    ...o.history.map((h) => ({ role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: h.content })),
    { role: 'user', content: o.message },
  ];
  const used: string[] = [];
  const sources: Array<{ title?: string; url?: string; uri?: string }> = [];
  const tools = toFnTools(decls);
  for (let step = 0; step < (o.maxSteps ?? 5); step++) {
    const r = await xaiChatStream(messages, tools, { onDelta: o.onDelta });
    if (!r.toolCalls.length) {
      if (!r.content.trim()) throw new Error('empty xAI response');
      return { text: r.content.trim(), model: r.model, tools: used, sources };
    }
    messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls });
    for (const tc of r.toolCalls) {
      let args: Record<string, unknown> = {};
      try { args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { /* bad args */ }
      let result: unknown;
      if (!allowed.has(tc.function.name)) result = { error: `unknown or forbidden tool: ${tc.function.name}` };
      else if (tc.function.name === 'search_web') {
        try { const w = await xaiWebSearch(String(args.query ?? o.message), 'Summarise the latest reputable reporting concisely, with dates. No trading advice.'); sources.push(...w.sources.map((x) => ({ title: x.title, url: x.url, uri: x.url }))); result = { summary: w.text, sources: w.sources.slice(0, 6) }; }
        catch (e) { result = { error: (e as Error).message }; }
      } else {
        try { result = await o.runTool(tc.function.name, args); } catch (e) { result = { error: (e as Error).message }; }
      }
      used.push(tc.function.name);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 20_000) });
    }
  }
  throw new Error('xAI tool loop did not finish');
}
