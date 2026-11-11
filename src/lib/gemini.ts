/** Minimal Gemini REST client. The API key is sent in a header, never in the URL or logs. */
import { getConfig } from './config';

export interface GeminiTurn { role: 'user' | 'model'; parts: { text: string }[] }
export interface GeminiResult { text: string; model: string; grounded: boolean; sources: Array<{ title: string; url: string }> }

export async function geminiGenerate(opts: { system: string; contents: GeminiTurn[]; search?: boolean; maxOutputTokens?: number; temperature?: number }): Promise<GeminiResult> {
  const c = getConfig();
  const key = process.env.GEMINI_API_KEY;
  if (!key || !c.hasGeminiKey) throw new Error('GEMINI_API_KEY not configured');
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: opts.system }] },
    contents: opts.contents,
    generationConfig: { maxOutputTokens: opts.maxOutputTokens ?? 1024, temperature: opts.temperature ?? 0.7 },
  };
  if (opts.search) body.tools = [{ google_search: {} }];
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.geminiModel)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const cand = j?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim();
  if (!text) throw new Error(`Gemini returned no text (${cand?.finishReason ?? 'unknown'})`);
  const chunks = cand?.groundingMetadata?.groundingChunks ?? [];
  const sources = chunks.map((ch: { web?: { uri?: string; title?: string } }) => ({ title: ch.web?.title ?? ch.web?.uri ?? '', url: ch.web?.uri ?? '' })).filter((s: { url: string }) => s.url);
  return { text, model: c.geminiModel, grounded: Boolean(opts.search && sources.length), sources };
}
