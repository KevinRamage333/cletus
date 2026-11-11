import { NextResponse } from 'next/server';
import { generate, toContents } from '@/lib/brain/gemini';
import { SYSTEM_PROMPT, secComplianceContext } from '@/lib/brain/persona';
export const dynamic = 'force-dynamic';

/** Public Brain demo: Gemini with the Cletus persona, NO tools, NO account/DB access. Tight rate limits protect the key's quota. */
const g = globalThis as unknown as { __demoBrain?: { ip: Map<string, number[]>; day: string; count: number } };
const st = (g.__demoBrain ??= { ip: new Map(), day: '', count: 0 });
const PER_IP = Number(process.env.DEMO_BRAIN_PER_IP_10MIN ?? 6);
const DAILY = Number(process.env.DEMO_BRAIN_DAILY_CAP ?? 150);

const DEMO_RULES = `## PUBLIC DEMO MODE
You are running as a public website demo. You have NO access to any account, wallet, positions, trades, or the trading engine. Accounts and live trading are "coming online soon". Do not invent portfolio numbers, PnL, or trades. Do not tell anyone to buy or sell anything or promise returns. Explain how Cletus works (scanner, 8 signals, token audit, risk limits, simulation-first beta), and answer finance/markets questions educationally. Keep answers under 180 words.`;

export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
  const now = Date.now(); const today = new Date().toISOString().slice(0, 10);
  if (st.day !== today) { st.day = today; st.count = 0; }
  const hits = (st.ip.get(ip) ?? ([] as number[])).filter((t: number) => now - t < 600_000);
  if (hits.length >= PER_IP) return NextResponse.json({ error: 'Demo limit reached. Try again in a few minutes.' }, { status: 429 });
  if (st.count >= DAILY) return NextResponse.json({ error: 'The demo Brain has hit its daily limit. Come back tomorrow.' }, { status: 429 });
  let body: { message?: string; history?: Array<{ role: string; content: string }> } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const message = String(body.message ?? '').trim().slice(0, 1000);
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });
  const history = (Array.isArray(body.history) ? body.history : []).slice(-6).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', content: String(m.content ?? '').slice(0, 1500) }));
  hits.push(now); st.ip.set(ip, hits); st.count++;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ answer: "I'm Cletus. In this demo my Brain is offline, but I scan Solana tokens, audit each one, score it on 8 signals, and paper-trade in the beta. Accounts are coming online soon.", source: 'mock' });
  try {
    const r = await generate({
      apiKey: key, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      system: `${SYSTEM_PROMPT}\n\n${secComplianceContext()}\n\n${DEMO_RULES}`,
      contents: toContents([...history, { role: 'user', content: message }]),
      temperature: 0.6, maxOutputTokens: 2048, timeoutMs: 25_000,
    });
    return NextResponse.json({ answer: r.text || '(no answer)', source: 'gemini', model: r.model });
  } catch {
    return NextResponse.json({ error: 'The Brain is busy right now. Try again in a minute.' }, { status: 503 });
  }
}
