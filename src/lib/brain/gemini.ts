/**
 * Minimal Gemini REST client (generateContent) with function calling and
 * optional Google Search grounding. `fetchImpl` is injectable for tests.
 */
import type { ToolDecl } from './tools';
import { checkLimit, limiter, limiterParams, parseRetryDelayMs, record429, recordCall, recordSuccess } from './ratelimit';

export interface Part { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: { name: string; response: unknown } }
export interface Content { role: 'user' | 'model'; parts: Part[] }
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GenerateOpts {
  apiKey: string;
  model: string;
  system?: string;
  contents: Content[];
  functions?: ToolDecl[];
  googleSearch?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface GenerateResult { parts: Part[]; text: string; grounding: Array<{ title?: string; uri?: string }> }

/**
 * Model resolution: GEMINI_MODEL first (default gemini-2.5-flash). If Google answers 404 (model retired /
 * "no longer available to new users"), try GEMINI_FALLBACK_MODELS in order and remember the first that works.
 */
const gm = globalThis as unknown as { __geminiResolved?: Map<string, string> };
const resolved = (gm.__geminiResolved ??= new Map());
export function geminiFallbacks(env: Record<string, string | undefined> = process.env): string[] {
  return (env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash,gemini-3.5-flash-lite').split(',').map((s) => s.trim()).filter(Boolean);
}
export function activeGeminiModel(configured: string): string { return resolved.get(configured) ?? configured; }

export async function generate(o: GenerateOpts): Promise<GenerateResult & { model: string }> {
  const first = activeGeminiModel(o.model);
  const candidates = [first, ...geminiFallbacks().filter((m) => m !== first)];
  let lastErr: Error | null = null;
  let retired = false;
  for (const m of candidates) {
    try {
      const r = await generateOnce({ ...o, model: m });
      if (retired && m !== o.model) resolved.set(o.model, m); // remember only when the configured model is gone
      return { ...r, model: m };
    } catch (e) {
      lastErr = e as Error;
      // Retired (404) or overloaded (503) models fall through to the next one; 429/400/etc. do not.
      if (/HTTP 404/.test(lastErr.message)) { if (m === first) retired = true; continue; }
      if (/HTTP 503/.test(lastErr.message)) continue;
      throw lastErr;
    }
  }
  throw lastErr ?? new Error('no Gemini model available');
}

async function generateOnce(o: GenerateOpts): Promise<GenerateResult> {
  const tools: unknown[] = [];
  if (o.functions?.length) tools.push({ functionDeclarations: o.functions });
  if (o.googleSearch) tools.push({ google_search: {} });
  const body = {
    ...(o.system ? { systemInstruction: { parts: [{ text: o.system }] } } : {}),
    contents: o.contents,
    ...(tools.length ? { tools } : {}),
    generationConfig: { temperature: o.temperature ?? 0.75, maxOutputTokens: o.maxOutputTokens ?? 1500 },
  };
  const f = o.fetchImpl ?? (fetch as FetchLike);
  // Free-tier limiter (skipped for injected test fetches).
  const lp = limiterParams();
  if (!o.fetchImpl) {
    const chk = checkLimit(limiter.get(), Date.now(), lp);
    if (!chk.ok) throw new Error(chk.reason);
    if (chk.waitMs > 0) {
      if (chk.waitMs > 20_000) throw new Error(`Gemini spacing: next slot in ${Math.ceil(chk.waitMs / 1000)}s`);
      await new Promise((r) => setTimeout(r, chk.waitMs));
    }
    limiter.set(recordCall(limiter.get(), Date.now()));
  }
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': o.apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(o.timeoutMs ?? 30000),
  });
  if (res.status === 429) {
    const body = await res.text().catch(() => '');
    if (!o.fetchImpl) limiter.set(record429(limiter.get(), Date.now(), lp, parseRetryDelayMs(res.headers.get('retry-after'), body)));
    throw new Error('Gemini HTTP 429 (rate limited, backing off)');
  }
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  if (!o.fetchImpl) limiter.set(recordSuccess(limiter.get()));
  const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Part[] }; groundingMetadata?: { groundingChunks?: Array<{ web?: { title?: string; uri?: string } }> } }> };
  const cand = j.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();
  const grounding = (cand?.groundingMetadata?.groundingChunks ?? []).map((g) => ({ title: g.web?.title, uri: g.web?.uri })).filter((g) => g.uri);
  return { parts, text, grounding };
}

export interface ToolTrace { name: string; args: Record<string, unknown>; ok: boolean }

/**
 * Multi-step function-calling loop: the model may request read-only tools; we execute
 * them and feed results back until it produces a text answer (max `maxSteps`).
 */
export async function chatWithTools(
  o: Omit<GenerateOpts, 'contents'> & { contents: Content[]; runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>; maxSteps?: number },
): Promise<{ text: string; trace: ToolTrace[] }> {
  const contents = [...o.contents];
  const trace: ToolTrace[] = [];
  for (let step = 0; step < (o.maxSteps ?? 5); step++) {
    const r = await generate({ ...o, contents });
    const calls = r.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      if (!r.text) throw new Error('empty Gemini response');
      return { text: r.text, trace };
    }
    contents.push({ role: 'model', parts: r.parts });
    const responses: Part[] = [];
    for (const p of calls) {
      const { name, args = {} } = p.functionCall!;
      let result: unknown;
      let ok = true;
      try { result = await o.runTool(name, args); } catch (e) { ok = false; result = { error: (e as Error).message }; }
      trace.push({ name, args, ok });
      responses.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  // Out of steps: ask for a final answer without tools.
  const final = await generate({ ...o, functions: undefined, contents: [...contents, { role: 'user', parts: [{ text: 'Answer now using the data above.' }] }] });
  return { text: final.text || 'I could not complete that request.', trace };
}

/** Map stored messages to Gemini contents (merging consecutive same-role turns). */
export function toContents(history: Array<{ role: string; content: string }>): Content[] {
  const out: Content[] = [];
  for (const m of history) {
    const role: Content['role'] = m.role === 'user' ? 'user' : 'model';
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push({ text: m.content });
    else out.push({ role, parts: [{ text: m.content }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
