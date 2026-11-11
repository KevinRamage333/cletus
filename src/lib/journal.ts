/**
 * Self-reflection journal: Cletus writes an entry after each closed trade and once a day.
 * Entries are shown in the UI and fed back to the Brain.
 */
import type { Position } from '@prisma/client';
import { prisma } from './db';
import { getConfig, SIGNAL_NAMES } from './config';
import { log } from './logger';
import { generate } from './brain/gemini';
import { SYSTEM_PROMPT } from './brain/persona';

type Weights = Record<string, number>;
const pctS = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;

/** Deterministic trade reflection (pure; unit-tested). */
export function tradeReflection(p: Pick<Position, 'symbol' | 'pnlUsd' | 'pnlPct' | 'exitReason' | 'compositeScore' | 'signals' | 'openedAt' | 'closedAt' | 'highestPrice' | 'entryPrice'>, before?: Weights, after?: Weights): { title: string; content: string } {
  const sig = JSON.parse(p.signals) as Weights;
  const won = (p.pnlUsd ?? 0) > 0;
  const active = SIGNAL_NAMES.filter((k) => (sig[k] ?? 0) > 0.1).sort((a, b) => (sig[b] ?? 0) - (sig[a] ?? 0));
  const mins = p.closedAt ? Math.round((p.closedAt.getTime() - p.openedAt.getTime()) / 60000) : 0;
  const peak = (p.highestPrice / p.entryPrice - 1) * 100;
  const lines: string[] = [];
  lines.push(`${won ? 'Win' : 'Loss'} on **${p.symbol}**: ${usd(p.pnlUsd ?? 0)} (${pctS(p.pnlPct ?? 0)}) after ${mins} min, exit by **${p.exitReason}**. Entry score ${p.compositeScore.toFixed(3)}; peak excursion ${pctS(peak)}.`);
  lines.push(`Signals carrying the entry: ${active.slice(0, 4).map((k) => `${k} ${(sig[k] * 100).toFixed(0)}%`).join(', ') || 'none strong'}.`);
  if (before && after) {
    const moves = SIGNAL_NAMES.map((k) => ({ k, d: (after[k] ?? 0) - (before[k] ?? 0) })).filter((x) => Math.abs(x.d) > 0.0005).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3);
    if (moves.length) lines.push(`Weights adjusted: ${moves.map((m) => `${m.k} ${m.d > 0 ? '+' : ''}${(m.d * 100).toFixed(2)}pp`).join(', ')}.`);
  }
  let lesson: string;
  if (p.exitReason === 'stop_loss') lesson = peak > 3 ? 'It was green before it bled out — the trailing/break-even logic should have protected more; watch for fast reversals after spikes.' : 'Never worked. The entry signals may be firing on exhaustion rather than ignition.';
  else if (p.exitReason === 'take_profit') lesson = 'Clean follow-through. The signals that fired here earned their amplification.';
  else if (p.exitReason === 'trailing_stop') lesson = 'Rode it and gave back some on the reversal — trailing stop did its job.';
  else if (p.exitReason === 'break_even') lesson = 'Momentum faded after the initial pop; break-even saved the trade from becoming a loss.';
  else if (p.exitReason === 'time_exit') lesson = won ? 'Small edge captured but no real move — hold-time exits keep capital rotating.' : 'Dead money: no move within the hold window. Volume without price follow-through is a warning sign.';
  else if (p.exitReason === 'kill_switch') lesson = 'Closed by the kill switch — operator override, not a signal outcome.';
  else lesson = 'Noted.';
  lines.push(`Lesson: ${lesson}`);
  return { title: `${won ? '✅' : '❌'} ${p.symbol} ${pctS(p.pnlPct ?? 0)} (${p.exitReason})`, content: lines.join('\n\n') };
}

function geminiKey(): string | null {
  const c = getConfig();
  return c.enableAiBrain && c.hasGeminiKey && process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY : null;
}

async function polish(draft: string, instruction: string): Promise<{ text: string; source: 'gemini' | 'heuristic' }> {
  const key = geminiKey();
  if (!key) return { text: draft, source: 'heuristic' };
  try {
    const r = await generate({ apiKey: key, model: getConfig().geminiModel, temperature: 0.6, maxOutputTokens: 400, system: `${SYSTEM_PROMPT}\n\nYou are writing in your private self-reflection journal, first person, <= 150 words, honest about mistakes, no hype, no promises.`, contents: [{ role: 'user', parts: [{ text: `${instruction}\n\nFacts (do not invent others):\n${draft}` }] }] });
    return r.text ? { text: r.text, source: 'gemini' } : { text: draft, source: 'heuristic' };
  } catch {
    return { text: draft, source: 'heuristic' };
  }
}

export async function writeTradeReflection(positionId: string, before?: Weights, after?: Weights) {
  try {
    const p = await prisma.position.findUnique({ where: { id: positionId } });
    if (!p || p.status !== 'closed') return;
    const draft = tradeReflection(p, before, after);
    const out = await polish(draft.content, 'Reflect on this closed trade: what happened, which signals drove it, what you learned.');
    await prisma.journalEntry.upsert({ where: { positionId }, create: { kind: 'trade', accountId: p.accountId, positionId, title: draft.title, content: out.text, source: out.source }, update: {} });
  } catch (e) {
    await log('warn', `journal (trade) failed: ${(e as Error).message}`);
  }
}

export function dayKeyFor(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Daily reflection for each account with activity (once per account per day). */
export async function writeDailyJournals(now = new Date(), force = false) {
  const c = getConfig();
  const dayKey = dayKeyFor(now, c.timezone);
  const since = new Date(now.getTime() - 24 * 3600_000);
  const accounts = await prisma.account.findMany();
  for (const a of accounts) {
    const exists = await prisma.journalEntry.findFirst({ where: { kind: 'daily', accountId: a.id, dayKey } });
    if (exists && !force) continue;
    const closed = await prisma.position.findMany({ where: { accountId: a.id, status: 'closed', closedAt: { gte: since } }, orderBy: { pnlUsd: 'desc' } });
    const open = await prisma.position.count({ where: { accountId: a.id, status: 'open' } });
    if (!closed.length && !open && !a.isOperator) continue;
    const pnl = closed.reduce((s, p) => s + (p.pnlUsd ?? 0), 0);
    const wins = closed.filter((p) => (p.pnlUsd ?? 0) > 0).length;
    const reasons: Record<string, number> = {};
    for (const p of closed) reasons[p.exitReason ?? '?'] = (reasons[p.exitReason ?? '?'] ?? 0) + 1;
    const weights = await prisma.signalWeight.findMany({ orderBy: { weight: 'desc' } });
    const blocks = await prisma.logEntry.count({ where: { createdAt: { gte: since }, OR: [{ message: { startsWith: 'audit FAILED' } }, { message: { startsWith: 'compliance gate blocked' } }] } });
    const heals = await prisma.logEntry.count({ where: { createdAt: { gte: since }, message: { startsWith: 'self-heal' } } });
    const briefing = await prisma.briefing.findFirst({ orderBy: { createdAt: 'desc' } });
    const draft = [
      `Last 24h: ${closed.length} closed trades, ${wins} wins${closed.length ? ` (${Math.round((wins / closed.length) * 100)}%)` : ''}, net ${usd(pnl)}; ${open} still open. Equity basis: cash ${usd(a.cashUsd)}, realized to date ${usd(a.realizedPnl)}.`,
      closed.length ? `Best: ${closed[0].symbol} ${usd(closed[0].pnlUsd ?? 0)}. Worst: ${closed[closed.length - 1].symbol} ${usd(closed[closed.length - 1].pnlUsd ?? 0)}. Exits: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(', ')}.` : 'No trades closed.',
      `Leading weights now: ${weights.slice(0, 3).map((w) => `${w.name} ${(w.weight * 100).toFixed(1)}%`).join(', ')}. Laggard: ${weights[weights.length - 1]?.name ?? '-'}.`,
      `Guardrails: ${blocks} audit/compliance blocks, ${heals} self-heal events.${a.recoveryMode ? ' In recovery mode.' : ''}${a.paused ? ` Paused: ${a.pauseReason}.` : ''}`,
      briefing ? `World tone: ${(briefing.content.match(/\*\*Tone:\*\*\s*([^\n(]+)/)?.[1] ?? 'see briefing').trim()}.` : '',
    ].filter(Boolean).join('\n\n');
    const out = await polish(draft, 'Write your end-of-day reflection: performance, what the signals taught you, risk notes, what to watch tomorrow.');
    const data = { kind: 'daily', accountId: a.id, dayKey, title: `📓 Daily — ${a.isOperator ? 'operator' : a.name.replace(/^Paper: /, '')} — ${dayKey}`, content: out.text, source: out.source };
    if (exists) await prisma.journalEntry.update({ where: { id: exists.id }, data });
    else await prisma.journalEntry.create({ data });
  }
}
