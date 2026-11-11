/**
 * xAI (Grok) provider via the OpenAI-compatible API at https://api.x.ai/v1.
 * - Chat Completions with streaming (SSE) and function calling for the read-only self-awareness tools.
 * - Responses API with the server-side `web_search` tool for live world events (RSS stays as backup).
 * The API key is sent only in the Authorization header and never logged.
 */
export const XAI_BASE_URL = 'https://api.x.ai/v1';
export const XAI_DEFAULT_MODEL = 'grok-4.7';

export interface ChatMsg { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface FnTool { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

export function xaiConfig(env: Record<string, string | undefined> = process.env) {
  const key = env.XAI_API_KEY && !env.XAI_API_KEY.startsWith('your_') && !env.XAI_API_KEY.startsWith('xai-xxx') ? env.XAI_API_KEY : null;
  return { key, model: (env.XAI_MODEL || XAI_DEFAULT_MODEL).trim(), baseUrl: (env.XAI_BASE_URL || XAI_BASE_URL).replace(/\/$/, ''), webSearch: env.XAI_WEB_SEARCH !== 'false' };
}

/** Parse an OpenAI-style SSE stream into final content + tool calls (pure over the text; unit-tested). */
export function parseChatSSE(raw: string): { content: string; toolCalls: ToolCall[]; finishReason: string | null } {
  let content = '';
  let finishReason: string | null = null;
  const calls: ToolCall[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const data = t.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let j: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { j = JSON.parse(data); } catch { continue; }
    const ch = j?.choices?.[0];
    if (!ch) continue;
    if (ch.delta?.content) content += ch.delta.content;
    for (const tc of ch.delta?.tool_calls ?? []) {
      const i = tc.index ?? calls.length;
      calls[i] ??= { id: tc.id ?? `call_${i}`, type: 'function', function: { name: '', arguments: '' } };
      if (tc.id) calls[i].id = tc.id;
      if (tc.function?.name) calls[i].function.name += tc.function.name;
      if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments;
    }
    if (ch.finish_reason) finishReason = ch.finish_reason;
  }
  return { content, toolCalls: calls.filter(Boolean), finishReason };
}

/** One streamed chat-completions round. `onDelta` receives text chunks as they arrive. */
export async function xaiChatStream(messages: ChatMsg[], tools: FnTool[], opts: { maxTokens?: number; temperature?: number; onDelta?: (s: string) => void; fetchImpl?: typeof fetch } = {}) {
  const c = xaiConfig();
  if (!c.key) throw new Error('XAI_API_KEY not configured');
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${c.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${c.key}` },
    body: JSON.stringify({ model: c.model, messages, stream: true, max_tokens: opts.maxTokens ?? 1200, temperature: opts.temperature ?? 0.7, ...(tools.length ? { tools, tool_choice: 'auto' } : {}) }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok || !res.body) throw new Error(`xAI HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let raw = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    raw += chunk;
    if (opts.onDelta) for (const l of chunk.split('\n')) { try { const d = JSON.parse(l.replace(/^data:\s*/, '')); const s = d?.choices?.[0]?.delta?.content; if (s) opts.onDelta(s); } catch { /* partial line */ } }
  }
  return { ...parseChatSSE(raw), model: c.model };
}

/** Extract text + citations from a Responses API payload (pure; unit-tested). */
export function parseResponsesOutput(j: any): { text: string; sources: Array<{ title: string; url: string }> } { // eslint-disable-line @typescript-eslint/no-explicit-any
  let text = typeof j?.output_text === 'string' ? j.output_text : '';
  const urls = new Map<string, string>();
  for (const o of j?.output ?? []) {
    if (o?.type !== 'message') continue;
    for (const p of o.content ?? []) {
      if (!j?.output_text && p?.type === 'output_text' && p.text) text += p.text;
      for (const a of p?.annotations ?? []) if (a?.url) urls.set(a.url, a.title ?? a.url);
    }
  }
  for (const u of j?.citations ?? []) if (typeof u === 'string') urls.set(u, urls.get(u) ?? u);
  return { text: text.trim(), sources: [...urls].map(([url, title]) => ({ url, title })) };
}

/** Live web search via the Responses API `web_search` tool. */
export async function xaiWebSearch(query: string, system: string, opts: { fetchImpl?: typeof fetch } = {}) {
  const c = xaiConfig();
  if (!c.key) throw new Error('XAI_API_KEY not configured');
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${c.baseUrl}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${c.key}` },
    body: JSON.stringify({ model: c.model, input: [{ role: 'system', content: system }, { role: 'user', content: query }], tools: [{ type: 'web_search' }] }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`xAI responses HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const out = parseResponsesOutput(await res.json());
  if (!out.text) throw new Error('xAI web search returned no text');
  return { ...out, model: c.model };
}
