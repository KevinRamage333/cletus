/**
 * Live drawdown tracker for the owner's on-chain trading wallet.
 *
 * The operator's Postgres book still carries ~$10k of paper history, so its peakEquity made the
 * max-drawdown pause and recovery mode useless for a ~$10 live wallet. This tracks a separate live
 * peak from on-chain equity (SOL x price + open live positions), adjusted for external flows so a
 * deposit never counts as profit and a withdrawal never counts as a loss:
 *   - Flow detection is in lamports (not USD, so SOL price moves are not flows). If the wallet's SOL
 *     balance changed while the bot sent no transaction since the previous sample, the change is an
 *     external deposit/withdrawal: the peak shifts by the same USD amount.
 *   - If the bot did transact (swap, rent reclaim, sweep) the sample just rebaselines; the change is
 *     trading P&L. Bot-initiated outflows (profit sweep) are recorded explicitly with recordFlow().
 * State lives in a box-local JSON file (LIVE_EQUITY_STORE, default logs/live-equity.json), atomic writes.
 * First observation initialises the peak at the current equity, so it never pauses on start.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface LiveEquityState {
  version: 1;
  startedAt: string;
  startEquityUsd: number;
  peakUsd: number;
  netFlowsUsd: number;
  lastLamports: number;
  lastEquityUsd: number;
  lastAt: number; // ms
  /** Set when the live drawdown pause fired; cleared (and the peak rebased) when the owner resumes. */
  ddPausedAt?: string | null;
  flows: { at: string; usd: number; lamports: number; kind: 'deposit' | 'withdrawal' | 'sweep' }[];
}

export interface Observation { equityUsd: number; lamports: number; solPriceUsd: number; at: number }

export interface ObserveResult {
  state: LiveEquityState;
  drawdownPct: number;
  flowUsd: number; // external flow detected by this observation (0 if none)
  initialised: boolean;
  /** False when the bot transacted around this sample: the book and the wallet may disagree for a moment, so
   *  the peak is not raised and no pause/recovery decision should be taken from it. */
  settled: boolean;
}

/** Ignore lamport wiggles below this (no bot tx means there should be none; dust airdrops etc.). */
export const MIN_FLOW_LAMPORTS = 1_000_000; // 0.001 SOL

export function drawdownPct(s: Pick<LiveEquityState, 'peakUsd' | 'lastEquityUsd'>): number {
  return s.peakUsd > 0 ? Math.max(0, ((s.peakUsd - s.lastEquityUsd) / s.peakUsd) * 100) : 0;
}

/**
 * Pure update. `botActive` = the bot sent (or may have sent) a transaction since the previous sample,
 * so any lamport change is trading, not an external flow.
 */
export function observeEquity(prev: LiveEquityState | null, o: Observation, botActive: boolean, minFlowLamports = MIN_FLOW_LAMPORTS): ObserveResult {
  const eq = Math.max(0, o.equityUsd);
  if (!prev) {
    const state: LiveEquityState = {
      version: 1, startedAt: new Date(o.at).toISOString(), startEquityUsd: eq, peakUsd: eq, netFlowsUsd: 0,
      lastLamports: o.lamports, lastEquityUsd: eq, lastAt: o.at, flows: [],
    };
    return { state, drawdownPct: 0, flowUsd: 0, initialised: true, settled: !botActive };
  }
  const s: LiveEquityState = { ...prev, flows: [...prev.flows] };
  let flowUsd = 0;
  const dLam = o.lamports - prev.lastLamports;
  if (!botActive && Math.abs(dLam) >= minFlowLamports && o.solPriceUsd > 0) {
    flowUsd = (dLam / 1e9) * o.solPriceUsd;
    s.netFlowsUsd += flowUsd;
    s.peakUsd += flowUsd;
    s.flows.push({ at: new Date(o.at).toISOString(), usd: round2(flowUsd), lamports: dLam, kind: flowUsd > 0 ? 'deposit' : 'withdrawal' });
    if (s.flows.length > 50) s.flows = s.flows.slice(-50);
  }
  // Mid-trade the wallet and the book can briefly double-count (sell landed, position not closed yet):
  // never raise the peak from such a sample.
  if (!botActive) s.peakUsd = Math.max(s.peakUsd, eq);
  s.peakUsd = Math.max(s.peakUsd, 0);
  s.lastLamports = o.lamports;
  s.lastEquityUsd = eq;
  s.lastAt = o.at;
  return { state: s, drawdownPct: drawdownPct(s), flowUsd, initialised: false, settled: !botActive };
}

/** Pure: a known bot-initiated flow (e.g. profit sweep, usd < 0) moves the peak, never counted as a loss. */
export function applyFlow(prev: LiveEquityState, usd: number, at: number, kind: 'sweep' | 'deposit' | 'withdrawal' = 'sweep'): LiveEquityState {
  const s: LiveEquityState = { ...prev, flows: [...prev.flows, { at: new Date(at).toISOString(), usd: round2(usd), lamports: 0, kind }] };
  s.netFlowsUsd += usd;
  s.peakUsd = Math.max(s.peakUsd + usd, 0);
  return s;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Process-level store + bot activity marker ────────────────────────────────

const file = () => process.env.LIVE_EQUITY_STORE || path.join(process.cwd(), 'logs', 'live-equity.json');
/** A sample is "bot active" if the bot transacted within this long before the previous sample (balance cache + RPC lag). */
const graceMs = () => Number(process.env.LIVE_FLOW_GRACE_MS ?? 30_000);

let cache: LiveEquityState | null | undefined;
let inFlight = 0;
let lastBotTxAt = 0;

export function loadState(): LiveEquityState | null {
  if (cache !== undefined) return cache;
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8')) as LiveEquityState;
    cache = s && s.version === 1 && Number.isFinite(s.peakUsd) ? s : null;
  } catch { cache = null; }
  return cache;
}
function persist(s: LiveEquityState) {
  cache = s;
  const f = file();
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(s, null, 1));
    fs.renameSync(`${f}.tmp`, f);
  } catch { /* never block trading on the state file */ }
}
/** Test hook. */
export function _resetForTests() { cache = undefined; inFlight = 0; lastBotTxAt = 0; }

/** Wrap anything that moves the wallet's SOL (swaps, rent reclaim, sweeps). */
export async function withBotTx<T>(fn: () => Promise<T>): Promise<T> {
  inFlight++; lastBotTxAt = Date.now();
  try { return await fn(); } finally { inFlight--; lastBotTxAt = Date.now(); }
}
export function botActiveSince(prevAt: number | null, now = Date.now()): boolean {
  if (inFlight > 0) return true;
  if (prevAt === null) return false;
  return lastBotTxAt > 0 && lastBotTxAt >= prevAt - graceMs() && lastBotTxAt <= now + 1;
}

/** Record an on-chain equity sample; returns the drawdown and any external flow detected. */
export function observeLive(o: Observation): ObserveResult {
  const prev = loadState();
  const active = botActiveSince(prev ? prev.lastAt : null, o.at);
  const r = observeEquity(prev, o, active);
  persist(r.state);
  return r;
}

export function recordFlow(usd: number, kind: 'sweep' | 'deposit' | 'withdrawal' = 'sweep', at = Date.now()): void {
  const prev = loadState();
  if (!prev || !Number.isFinite(usd) || usd === 0) return;
  persist(applyFlow(prev, usd, at, kind));
}

export function describeLive(s: LiveEquityState | null): string {
  if (!s) return 'live equity: not sampled yet';
  return `live equity $${s.lastEquityUsd.toFixed(2)} (peak $${s.peakUsd.toFixed(2)}, net deposits ${s.netFlowsUsd >= 0 ? '+' : '-'}$${Math.abs(s.netFlowsUsd).toFixed(2)}, drawdown ${drawdownPct(s).toFixed(1)}%)`;
}

export function markDrawdownPause(at = Date.now()): void {
  const prev = loadState();
  if (prev) persist({ ...prev, ddPausedAt: new Date(at).toISOString() });
}

/** Owner resumed after a drawdown pause: the current equity becomes the new peak. */
export function rebasePeak(equityUsd: number, lamports: number, at = Date.now()): LiveEquityState {
  const prev = loadState();
  const eq = Math.max(0, equityUsd);
  const s: LiveEquityState = prev
    ? { ...prev, peakUsd: eq, lastEquityUsd: eq, lastLamports: lamports, lastAt: at, ddPausedAt: null }
    : observeEquity(null, { equityUsd: eq, lamports, solPriceUsd: 0, at }, false).state;
  persist(s);
  return s;
}
