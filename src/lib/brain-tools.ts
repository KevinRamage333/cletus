/**
 * Self-awareness tools: READ-ONLY views of Cletus's own live state.
 * The Brain is advisory only. No tool here can open, close, size or cancel a trade,
 * toggle the kill switch, or change config. Trade execution lives only in engine.ts.
 */
export interface BrainContext {
  mode: string; preset: string; aggression: string; killSwitch: boolean; killReason?: string | null; withinSchedule?: boolean;
  equity: number; cash: number; realizedPnl: number; unrealizedPnl: number; winRate: number | null; closedTrades: number;
  pnlDay?: number; pnlWeek?: number; tier?: number; tierMultiplier?: number; paused?: boolean; recoveryMode?: boolean;
  openPositions: Array<{ symbol: string; sizeUsd: number; pnlPct: number; pnlUsd?: number; openedAt?: string | Date }>;
  recentTrades?: Array<{ symbol: string; pnlUsd: number | null; pnlPct: number | null; exitReason: string | null }>;
  weights: Record<string, number>;
  topCandidates: Array<{ symbol: string; composite: number; marketCap: number; volMcap: number }>;
  lastScan: string;
  health?: { scanCount: number; lastScanAt: string | Date | null; consecutiveFailures: number; priorityFeeLamports: number; slippageBps: number; pausedUntil: string | Date | null; lastError: string | null };
}

export interface ToolExtras { briefing?: string | null; briefingAt?: Date | null; journal?: Array<{ title: string; content: string; createdAt: Date }> }

const r2 = (n: number) => Math.round(n * 100) / 100;

export const SELF_TOOLS = {
  get_mode: { description: 'Trading mode, preset, aggression, kill switch and schedule', run: (c: BrainContext) => ({ mode: c.mode, preset: c.preset, aggression: c.aggression, killSwitch: c.killSwitch, killReason: c.killReason ?? null, withinSchedule: c.withinSchedule ?? null, paused: c.paused ?? false, recoveryMode: c.recoveryMode ?? false }) },
  get_pnl: { description: 'Equity, cash, realized/unrealized P&L, win rate, sizing tier', run: (c: BrainContext) => ({ equity: r2(c.equity), cash: r2(c.cash), realizedPnl: r2(c.realizedPnl), unrealizedPnl: r2(c.unrealizedPnl), today: c.pnlDay ?? null, week: c.pnlWeek ?? null, closedTrades: c.closedTrades, winRate: c.winRate === null ? null : r2(c.winRate * 100), tier: c.tier ?? null, tierMultiplier: c.tierMultiplier ?? null }) },
  get_positions: { description: 'Open positions with size and unrealized P&L', run: (c: BrainContext) => c.openPositions.map((p) => ({ symbol: p.symbol, sizeUsd: r2(p.sizeUsd), pnlPct: r2(p.pnlPct), pnlUsd: p.pnlUsd === undefined ? null : r2(p.pnlUsd) })) },
  get_recent_trades: { description: 'Most recent closed trades', run: (c: BrainContext) => (c.recentTrades ?? []).slice(0, 10) },
  get_weights: { description: 'Self-learned signal weights, highest first', run: (c: BrainContext) => Object.entries(c.weights).sort((a, b) => b[1] - a[1]).map(([name, w]) => ({ name, weightPct: r2(w * 100) })) },
  get_scanner: { description: 'Latest scan summary and top-ranked candidates', run: (c: BrainContext) => ({ lastScan: c.lastScan, top: c.topCandidates.slice(0, 5) }) },
  get_health: { description: 'Self-healing state: failures, fees, slippage, pauses, last error', run: (c: BrainContext) => c.health ?? null },
  get_news: { description: 'Rolling world-events briefing', run: (_c: BrainContext, x: ToolExtras) => ({ briefing: x.briefing ?? null, at: x.briefingAt ?? null }) },
  get_journal: { description: 'Recent self-reflection journal entries', run: (_c: BrainContext, x: ToolExtras) => (x.journal ?? []).slice(0, 5).map((j) => ({ title: j.title, content: j.content.slice(0, 600), at: j.createdAt })) },
} as const;

export type ToolName = keyof typeof SELF_TOOLS;
export const TOOL_NAMES = Object.keys(SELF_TOOLS) as ToolName[];

/** Pick the read-only tools relevant to a question (pure; unit-tested). Mode + P&L are always included. */
export function selectTools(q: string): ToolName[] {
  const s = q.toLowerCase();
  const t = new Set<ToolName>(['get_mode', 'get_pnl']);
  if (/position|holding|open|bag|exposure/.test(s)) t.add('get_positions');
  if (/trade|win|loss|lost|closed|history|recent/.test(s)) { t.add('get_recent_trades'); t.add('get_positions'); }
  if (/weight|signal|learn|pattern|score/.test(s)) t.add('get_weights');
  if (/scan|candidate|token|coin|watch|market|hunt/.test(s)) t.add('get_scanner');
  if (/health|heal|error|fail|fee|slippage|rpc|broken|status|ok\b|how are you/.test(s)) t.add('get_health');
  if (/news|world|event|headline|fed|rate|inflation|economy|macro|today|happening|war|election|briefing|bitcoin|btc|eth/.test(s)) t.add('get_news');
  if (/journal|reflect|lesson|learned|think|feel|self|yourself|who are you/.test(s)) { t.add('get_journal'); t.add('get_weights'); }
  if (/everything|full|overview|summary|report/.test(s)) TOOL_NAMES.forEach((n) => t.add(n));
  return [...t];
}

export function runTools(names: ToolName[], ctx: BrainContext, extras: ToolExtras) {
  const out: Record<string, unknown> = {};
  for (const n of names) out[n] = SELF_TOOLS[n].run(ctx, extras);
  return out;
}

/** Detect a request for the Brain to execute an action it is not allowed to take (pure; unit-tested). */
export function detectActionRequest(q: string): string | null {
  const s = q.toLowerCase();
  if (/\b(buy|ape|snipe|enter|long|short)\b.{0,40}\b(now|for me|token|coin|position|\$|sol\b|it)\b/.test(s) || /^\s*(buy|sell|ape|snipe)\b/.test(s)) return 'trade';
  if (/\b(sell|close|exit|dump)\b.{0,30}\b(position|everything|all|it|bag|now|for me)\b/.test(s)) return 'trade';
  if (/\b(turn|switch|flip|activate|release|trigger|hit)\b.{0,20}\bkill.?switch\b/.test(s)) return 'kill_switch';
  if (/\b(go|switch|turn|set)\b.{0,20}\blive\b/.test(s) || /\b(change|set|raise|lower|increase|decrease)\b.{0,30}\b(stop.?loss|take.?profit|size|preset|aggression|slippage|config)\b/.test(s)) return 'config';
  if (/\b(send|transfer|withdraw|move)\b.{0,30}\b(sol|funds|money|usdc|wallet)\b/.test(s)) return 'funds';
  return null;
}

export const ACTION_REFUSAL: Record<string, string> = {
  trade: "I can't place or close trades from chat. I'm advisory only. The deterministic signal engine makes every entry and exit, and it runs through the audit and compliance gates. On the dashboard you can pause your account or hit the kill switch.",
  kill_switch: "I can't flip the kill switch from chat. Use the ⛔ Kill Switch button on the dashboard. It halts entries and closes every open position.",
  config: "I can't change trading mode or parameters from chat. Those come from server config (.env / presets), and live mode needs explicit operator configuration.",
  funds: "I can't move funds or touch any wallet. Private keys never reach the Brain.",
};
