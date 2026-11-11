/**
 * On-chain whale flow (Helius Parsed Events) + X hype (X API v2) collectors. Both write timestamped rows to the LLC's
 * market_data schema so they can be backtested later, and keep an in-memory view for the engine (veto / fast exit)
 * and the Brain. Off unless MARKET_DATA_DATABASE_URL is set; X part off unless X_BEARER_TOKEN is set.
 *
 * Helius budget: Parsed Events transaction-history = 10 credits per call (≤ 100 txs); fresh-wallet check = 1 credit
 * (getSignaturesForAddress); holder snapshot (DAS) = 10 credits. A daily credit bucket (HELIUS_FLOW_CREDITS_PER_DAY,
 * default 10,000 ≈ 300k/month, 30% of the free plan) caps everything; open positions are served first.
 */
import { swapFromParsed, flowFeatures, discoverSmartMoney, whaleExitDecision, whaleGate, describeFlow, type WhaleSwap, type WatchedWallet, type FlowFeatures, type ParsedTx } from './whales';
import { xConfig, buildQuery, parseCounts, authorSample, hypeFeatures, hypeDivergence, hypeGate, X_API, type CountBucket, type AuthorSample, type HypeFeatures, type Divergence } from './social/x';

export type FlowTarget = { mint: string; pool: string; symbol: string; priceUsd: number; liquidityUsd: number | null; creator: string | null; position: boolean; buyRatio5m: number | null; priceChangeH1: number; priceChangeM5: number };
interface HypeView { h: HypeFeatures; a: AuthorSample | null; div: { kind: Divergence; message: string }; at: number }
interface FlowState {
  swaps: Map<string, WhaleSwap[]>; features: Map<string, { f: FlowFeatures; at: number; symbol: string }>; hype: Map<string, HypeView>; counts: Map<string, CountBucket[]>;
  watched: WatchedWallet[]; fresh: Set<string>; notFresh: Set<string>; lastPolled: Map<string, number>; lastBlock: Map<string, number>; lastX: Map<string, number>; top10: Map<string, Array<{ at: number; pct: number }>>;
  credits: { day: string; used: number }; xReq: { day: string; used: number };
  status: { whaleTicks: number; whaleCalls: number; swapsStored: number; xTicks: number; xCalls: number; lastError: string | null; smartWallets: number };
  timers: NodeJS.Timeout[];
}
const g = globalThis as unknown as { __flow?: FlowState; __flowPool?: import('pg').Pool };
const S: FlowState = (g.__flow ??= {
  swaps: new Map(), features: new Map(), hype: new Map(), counts: new Map(), watched: [], fresh: new Set(), notFresh: new Set(), lastPolled: new Map(), lastBlock: new Map(), lastX: new Map(), top10: new Map(),
  credits: { day: '', used: 0 }, xReq: { day: '', used: 0 }, status: { whaleTicks: 0, whaleCalls: 0, swapsStored: 0, xTicks: 0, xCalls: 0, lastError: null, smartWallets: 0 }, timers: [],
});
const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
export const flowOpts = () => ({
  creditsPerDay: num('HELIUS_FLOW_CREDITS_PER_DAY', 10_000), maxPools: num('WHALE_MAX_POOLS', 6),
  positionIntervalMs: num('WHALE_POSITION_INTERVAL_SECONDS', 120) * 1000, candidateIntervalMs: num('WHALE_CANDIDATE_INTERVAL_SECONDS', 600) * 1000,
  fastExit: process.env.WHALE_FAST_EXIT !== 'off', vetoMode: (['off', 'on'].includes(process.env.SIGNAL_VETO_MODE ?? '') ? process.env.SIGNAL_VETO_MODE : 'shadow') as 'off' | 'shadow' | 'on',
});
/** Helius calls/day the budget allows at 10 credits per history call (for status / the report). */
export const estimatedHeliusUsage = () => { const o = flowOpts(); return { creditsPerDay: o.creditsPerDay, creditsPerMonth: o.creditsPerDay * 30, historyCallsPerDayMax: Math.floor(o.creditsPerDay / 10) }; };
const today = () => new Date().toISOString().slice(0, 10);
function spend(credits: number): boolean {
  if (S.credits.day !== today()) S.credits = { day: today(), used: 0 };
  if (S.credits.used + credits > flowOpts().creditsPerDay) return false;
  S.credits.used += credits; return true;
}
const enabled = () => !!process.env.MARKET_DATA_DATABASE_URL && process.env.FLOW_COLLECTOR !== 'off';

async function db() {
  if (g.__flowPool) return g.__flowPool;
  const { default: pg } = await import('pg');
  const u = new URL(process.env.MARKET_DATA_DATABASE_URL!); u.searchParams.delete('sslmode');
  const ca = process.env.PG_SSL_CA ? (await import('node:fs')).readFileSync(process.env.PG_SSL_CA, 'utf8') : undefined;
  g.__flowPool = new pg.Pool({ connectionString: u.toString(), max: 2, ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false } });
  g.__flowPool.on('error', (e) => { S.status.lastError = e.message; });
  return g.__flowPool;
}

export const FLOW_DDL = `
create table if not exists market_data.whale_swaps (
  signature text not null, mint text not null, pool text not null, wallet text not null, side text not null check (side in ('buy','sell')),
  token_amount numeric not null, sol_amount numeric, usd numeric not null, block_time timestamptz not null, slot bigint, collected_at timestamptz not null default now(),
  primary key (signature, mint, wallet));
create index if not exists whale_swaps_mint_time on market_data.whale_swaps (mint, block_time);
create index if not exists whale_swaps_wallet on market_data.whale_swaps (wallet);
create table if not exists market_data.watched_wallets (
  address text not null, kind text not null check (kind in ('smart','dev','top_holder','insider','manual')), mint text not null default '',
  label text, score numeric, source text not null default 'auto', added_at timestamptz not null default now(), primary key (address, kind, mint));
create table if not exists market_data.flow_features (
  mint text not null, taken_at timestamptz not null, window_min int not null, features jsonb not null, verdict jsonb, primary key (mint, taken_at));
create table if not exists market_data.holder_snapshots (mint text not null, taken_at timestamptz not null default now(), top10_pct numeric, top1_pct numeric, holders int, primary key (mint, taken_at));
create table if not exists market_data.x_mention_counts (
  mint text not null, bucket_start timestamptz not null, bucket_sec int not null, posts int not null, query text not null, collected_at timestamptz not null default now(),
  primary key (mint, bucket_start, bucket_sec));
create table if not exists market_data.x_author_samples (
  mint text not null, taken_at timestamptz not null default now(), posts int, unique_authors int, reach numeric, bot_share numeric, dup_share numeric,
  new_account_share numeric, organic_ratio numeric, top_authors jsonb, primary key (mint, taken_at));
create table if not exists market_data.x_hype_features (mint text not null, taken_at timestamptz not null, features jsonb not null, divergence text, message text, primary key (mint, taken_at));`;
let ddlDone = false;
async function ensure() { if (ddlDone) return; await (await db()).query(FLOW_DDL); ddlDone = true; }

async function targets(): Promise<FlowTarget[]> {
  const [{ prisma }, { mem }] = await Promise.all([import('./db'), import('./engine')]);
  const pos = await prisma.position.findMany({ where: { status: 'open' }, select: { mint: true, pairAddress: true, symbol: true, lastPrice: true, creator: true } });
  const out = new Map<string, FlowTarget>();
  const cand = new Map(mem.candidates.map((c) => [c.mint, c]));
  const flow = (c: any) => ({ buyRatio5m: null as number | null, priceChangeH1: c?.priceChangeH1 ?? 0, priceChangeM5: 0 });
  for (const p of pos) if (p.pairAddress && !out.has(p.mint)) { const c = cand.get(p.mint); out.set(p.mint, { mint: p.mint, pool: p.pairAddress, symbol: p.symbol, priceUsd: p.lastPrice, liquidityUsd: mem.liquidity.get(p.mint) ?? null, creator: p.creator ?? c?.audit?.creator ?? null, position: true, ...flow(c) }); }
  for (const c of [...mem.candidates].filter((c) => !c.rejected).sort((a, b) => b.composite - a.composite)) {
    if (out.size >= Math.max(flowOpts().maxPools, pos.length)) break;
    if (!out.has(c.mint) && c.pairAddress) out.set(c.mint, { mint: c.mint, pool: c.pairAddress, symbol: c.symbol, priceUsd: c.priceUsd, liquidityUsd: c.liquidityUsd, creator: c.audit?.creator ?? null, position: false, ...flow(c) });
  }
  return [...out.values()];
}

async function loadWatched() {
  const r = await (await db()).query(`select address, kind, mint, label, score from market_data.watched_wallets`);
  const manual = (process.env.WATCHED_WALLETS ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [address, label] = x.split(':'); return { address, kind: 'manual' as const, mint: '', label: label ?? 'owner' }; });
  S.watched = [...r.rows.map((x) => ({ address: x.address, kind: x.kind, mint: x.mint, label: x.label, score: x.score === null ? null : Number(x.score) })), ...manual];
}

async function freshCheck(wallets: string[]) {
  const { rpcCall } = await import('./rpc-pool');
  for (const w of wallets.slice(0, 8)) {
    if (S.fresh.has(w) || S.notFresh.has(w) || !spend(1)) continue;
    try { const sigs = await rpcCall<unknown[]>('getSignaturesForAddress', [w, { limit: 25 }], { timeoutMs: 5000 }); (sigs.length < 25 ? S.fresh : S.notFresh).add(w); } catch { /* skip */ }
  }
}

export async function whaleTick(now = Date.now(), override?: FlowTarget[]) {
  const key = process.env.HELIUS_API_KEY; if (!key || !enabled()) return;
  try {
    await ensure(); const pool = await db();
    if (S.status.whaleTicks % 30 === 0) await loadWatched();
    const { mem } = await import('./engine');
    const o = flowOpts();
    for (const t of override ?? await targets()) {
      const interval = t.position ? o.positionIntervalMs : o.candidateIntervalMs;
      if (now - (S.lastPolled.get(t.pool) ?? 0) < interval) continue;
      if (!spend(10)) break;
      S.lastPolled.set(t.pool, now);
      const body: Record<string, unknown> = { address: t.pool, limit: 100 };
      const since = S.lastBlock.get(t.pool); if (since) body.time = { gt: since };
      const res = await fetch(`https://mainnet.helius-rpc.com/v1/parsed-events/transaction-history?api-key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000), cache: 'no-store' });
      S.status.whaleCalls++;
      if (!res.ok) { S.status.lastError = `helius parsed-events ${res.status}`; continue; }
      const page = (await res.json()) as { data?: ParsedTx[] };
      const swaps = (page.data ?? []).map((tx) => swapFromParsed(tx, t.mint, t.pool, t.priceUsd, mem.solPrice || 150)).filter((s): s is WhaleSwap => !!s);
      if (swaps.length) {
        S.lastBlock.set(t.pool, Math.max(...swaps.map((s) => s.blockTime)));
        const vals: unknown[] = []; const rows: string[] = [];
        swaps.forEach((s, i) => { const b = i * 10; rows.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},to_timestamp($${b + 9}),$${b + 10})`); vals.push(s.signature, s.mint, s.pool, s.wallet, s.side, s.tokenAmount, s.solAmount, s.usd, s.blockTime, s.slot); });
        await pool.query(`insert into market_data.whale_swaps (signature, mint, pool, wallet, side, token_amount, sol_amount, usd, block_time, slot) values ${rows.join(',')} on conflict do nothing`, vals);
        S.status.swapsStored += swaps.length;
      }
      const all = [...(S.swaps.get(t.mint) ?? []), ...swaps].filter((s, i, a) => a.findIndex((x) => x.signature === s.signature && x.wallet === s.wallet) === i).filter((s) => s.blockTime > now / 1000 - 6 * 3600);
      S.swaps.set(t.mint, all);
      if (t.creator) {
        await pool.query(`insert into market_data.watched_wallets (address, kind, mint, label, source) values ($1,'dev',$2,$3,'rugcheck') on conflict do nothing`, [t.creator, t.mint, `${t.symbol} deployer`]);
        if (!S.watched.some((w) => w.address === t.creator && w.kind === 'dev' && w.mint === t.mint)) S.watched.push({ address: t.creator, kind: 'dev', mint: t.mint });
      }
      // Fresh-wallet check only for buyers inside a ≥4-buyer, 2-minute burst (cheap: 1 credit each, ≤ 8 per pool).
      const recentBuys = all.filter((s) => s.side === 'buy' && s.blockTime > now / 1000 - 600).sort((a, b) => a.blockTime - b.blockTime);
      for (let i = 0; i + 3 < recentBuys.length; i++) if (recentBuys[i + 3].blockTime - recentBuys[i].blockTime <= 120) { await freshCheck([...new Set(recentBuys.slice(i, i + 8).map((s) => s.wallet))]); break; }
      // Top-10 concentration change (DAS, 10 credits) every 30 min for open positions only.
      let topChange: number | null = null;
      if (t.position) {
        const hist = S.top10.get(t.mint) ?? [];
        if ((!hist.length || now - hist[hist.length - 1].at > 30 * 60_000) && spend(10)) {
          const { onchainHolders } = await import('./helius');
          const h = await onchainHolders(t.mint).catch(() => null);
          if (h) { hist.push({ at: now, pct: h.top10Pct }); S.top10.set(t.mint, hist.slice(-6)); await pool.query(`insert into market_data.holder_snapshots (mint, top10_pct, top1_pct, holders) values ($1,$2,$3,$4)`, [t.mint, h.top10Pct, h.top1Pct, h.holders]); }
        }
        const hs = S.top10.get(t.mint) ?? []; if (hs.length >= 2) topChange = hs[hs.length - 1].pct - hs[0].pct;
      }
      const f = flowFeatures(t.mint, all, S.watched, { nowSec: Math.floor(now / 1000), windowMin: 30, liquidityUsd: t.liquidityUsd, freshWallets: S.fresh, topHolderChangePct: topChange });
      S.features.set(t.mint, { f, at: now, symbol: t.symbol });
      await pool.query(`insert into market_data.flow_features (mint, taken_at, window_min, features, verdict) values ($1, to_timestamp($2), $3, $4, $5) on conflict do nothing`, [t.mint, now / 1000, 30, JSON.stringify(f), JSON.stringify(whaleGate(f))]);
    }
    // Smart-money discovery every ~30 ticks from the stored history (no extra Helius credits).
    if (S.status.whaleTicks % 30 === 0) {
      const r = await pool.query(`select signature, mint, pool, wallet, side, token_amount, usd, extract(epoch from block_time)::bigint t from market_data.whale_swaps where block_time > now() - interval '7 days'`);
      const sm = discoverSmartMoney(r.rows.map((x) => ({ signature: x.signature, mint: x.mint, pool: x.pool, wallet: x.wallet, side: x.side, tokenAmount: Number(x.token_amount), solAmount: 0, usd: Number(x.usd), blockTime: Number(x.t), slot: null })));
      for (const w of sm.slice(0, 200)) await pool.query(`insert into market_data.watched_wallets (address, kind, mint, label, score, source) values ($1,'smart','',$2,$3,'auto-pnl') on conflict (address, kind, mint) do update set score = excluded.score, label = excluded.label`, [w.address, `realized +$${Math.round(w.realizedUsd)} on ${w.tokens} tokens (${w.wins} wins)`, w.realizedUsd]);
      S.status.smartWallets = sm.length;
    }
    S.status.whaleTicks++; S.status.lastError = null;
  } catch (e) { S.status.lastError = (e as Error).message.slice(0, 200); }
}

export async function xTick(now = Date.now()) {
  const cfg = xConfig(); if (!cfg.enabled || !enabled()) return;
  try {
    await ensure(); const pool = await db();
    if (S.xReq.day !== today()) S.xReq = { day: today(), used: 0 };
    let done = 0;
    for (const t of await targets()) {
      if (done >= cfg.tokensPerTick || S.xReq.used + 1 > cfg.maxRequestsPerDay) break;
      if (now - (S.lastX.get(t.mint) ?? 0) < cfg.perTokenIntervalMin * 60_000) continue;
      S.lastX.set(t.mint, now); done++;
      const q = buildQuery(t.symbol, t.mint);
      const headers = { authorization: `Bearer ${cfg.token}` };
      const start = new Date(now - 3 * 3600_000).toISOString();
      S.xReq.used++; S.status.xCalls++;
      const cr = await fetch(`${X_API}/tweets/counts/recent?${new URLSearchParams({ query: q, granularity: 'minute', start_time: start })}`, { headers, signal: AbortSignal.timeout(10000), cache: 'no-store' });
      if (!cr.ok) { S.status.lastError = `X counts ${cr.status}`; if (cr.status === 429 || cr.status === 401 || cr.status === 403) break; continue; }
      const minute = parseCounts(await cr.json());
      // Store as 15-minute buckets.
      const b15 = new Map<number, number>(); for (const b of minute) { const k = Math.floor(b.start / 900) * 900; b15.set(k, (b15.get(k) ?? 0) + b.count); }
      for (const [k, v] of b15) await pool.query(`insert into market_data.x_mention_counts (mint, bucket_start, bucket_sec, posts, query) values ($1, to_timestamp($2), 900, $3, $4) on conflict (mint, bucket_start, bucket_sec) do update set posts = excluded.posts, collected_at = now()`, [t.mint, k, v, q]);
      S.counts.set(t.mint, minute);
      const h = hypeFeatures(minute, Math.floor(now / 1000));
      let a = S.hype.get(t.mint)?.a ?? null;
      // Author-quality sample only when there is something to sample, and within budget.
      if (h.posts1h >= 5 && S.xReq.used + 1 <= cfg.maxRequestsPerDay) {
        S.xReq.used++; S.status.xCalls++;
        const sr = await fetch(`${X_API}/tweets/search/recent?${new URLSearchParams({ query: q, max_results: String(cfg.searchSample), 'tweet.fields': 'created_at,author_id', expansions: 'author_id', 'user.fields': 'created_at,public_metrics,username' })}`, { headers, signal: AbortSignal.timeout(10000), cache: 'no-store' });
        if (sr.ok) { a = authorSample(await sr.json(), now); await pool.query(`insert into market_data.x_author_samples (mint, posts, unique_authors, reach, bot_share, dup_share, new_account_share, organic_ratio, top_authors) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [t.mint, a.posts, a.uniqueAuthors, a.reach, a.botShare, a.dupShare, a.newAccountShare, a.organicRatio, JSON.stringify(a.topAuthors)]); }
      }
      const fl = S.features.get(t.mint)?.f;
      const div = hypeDivergence(h, a, { priceChangeH1: t.priceChangeH1, buyRatio1h: fl?.flowRatio ?? null });
      S.hype.set(t.mint, { h, a, div, at: now });
      await pool.query(`insert into market_data.x_hype_features (mint, taken_at, features, divergence, message) values ($1, to_timestamp($2), $3, $4, $5) on conflict do nothing`, [t.mint, now / 1000, JSON.stringify({ ...h, author: a }), div.kind, div.message]);
    }
    S.status.xTicks++;
  } catch (e) { S.status.lastError = (e as Error).message.slice(0, 200); }
}

export function startFlowCollectors() {
  if (!enabled() || S.timers.length) return;
  S.timers.push(setInterval(() => void whaleTick(), 60_000), setInterval(() => void xTick(), 60_000));
  setTimeout(() => void whaleTick(), 20_000);
}

// ─── Read side: engine + Brain ───────────────────────────────────────────────
const FRESH_MS = 15 * 60_000;
export function flowFor(mint: string, now = Date.now()) { const v = S.features.get(mint); return v && now - v.at < FRESH_MS ? v.f : null; }
export function hypeFor(mint: string, now = Date.now()) { const v = S.hype.get(mint); return v && now - v.at < 2 * FRESH_MS ? v : null; }

/** Fast-exit reason for an open position (dev dump / whale or smart-money exit), or null. */
export function flowExitFor(mint: string): 'dev_exit' | 'whale_exit' | null { return flowOpts().fastExit ? whaleExitDecision(flowFor(mint)) : null; }

/** Combined confirmer/veto for a candidate that ALREADY passed the score threshold. */
export function entryVerdict(mint: string) {
  const w = whaleGate(flowFor(mint)); const h = hypeFor(mint); const hg = h ? hypeGate(h.div) : { veto: false, confirm: false };
  return { mode: flowOpts().vetoMode, veto: w.veto || hg.veto, confirm: (w.confirm || hg.confirm) && !(w.veto || hg.veto), reasons: [...w.reasons, ...(h ? [h.div.message] : [])] };
}

export function flowStatus() {
  return { enabled: enabled(), xEnabled: xConfig().enabled, xNeedsToken: !xConfig().token, heliusCreditsToday: S.credits.used, xRequestsToday: S.xReq.used, budget: estimatedHeliusUsage(), xBudgetPerDay: xConfig().maxRequestsPerDay, ...S.status, tracked: S.features.size, watchedWallets: S.watched.length };
}

export async function whaleActivity(query: { mint?: string; symbol?: string }) {
  const entry = [...S.features.entries()].find(([m, v]) => (query.mint && m === query.mint) || (query.symbol && v.symbol.toLowerCase() === query.symbol.replace(/^\$/, '').toLowerCase()));
  if (!entry) return { found: false, note: enabled() ? 'This token is not being tracked right now (only open positions and top scan candidates are, to stay inside the Helius budget).' : 'Whale tracking is off (no market_data database).', status: flowStatus() };
  const [mint, v] = entry; const big = (S.swaps.get(mint) ?? []).filter((s) => s.usd >= v.f.whaleThresholdUsd).sort((a, b) => b.blockTime - a.blockTime).slice(0, 10);
  const kinds = new Map(S.watched.map((w) => [w.address, w.kind]));
  return { found: true, symbol: v.symbol, mint, asOf: new Date(v.at).toISOString(), summary: describeFlow(v.f, v.symbol), verdict: whaleGate(v.f), fastExit: whaleExitDecision(v.f), features: v.f,
    bigMovers: big.map((s) => ({ side: s.side, usd: Math.round(s.usd), wallet: s.wallet, tag: kinds.get(s.wallet) ?? null, time: new Date(s.blockTime * 1000).toISOString(), solscan: `https://solscan.io/tx/${s.signature}` })) };
}

export function socialHype(query: { mint?: string; symbol?: string }) {
  const cfg = xConfig();
  if (!cfg.token) return { found: false, note: 'X hype scanning is built but has no X API access yet: the owner needs to add X_BEARER_TOKEN (X API v2, recent search + counts) to the server environment.' };
  const fx = [...S.features.entries()].find(([, v]) => query.symbol && v.symbol.toLowerCase() === query.symbol.replace(/^\$/, '').toLowerCase());
  const mint = query.mint ?? fx?.[0];
  const h = mint ? hypeFor(mint) : null;
  if (!h) return { found: false, note: 'No recent X mention data for this token (only open positions and top candidates are tracked, every 15 min).' };
  return { found: true, mint, asOf: new Date(h.at).toISOString(), divergence: h.div.kind, message: h.div.message, mentions: h.h, authors: h.a, gate: hypeGate(h.div) };
}

/** Stored whale swaps for chart markers (≥ whale threshold). */
export async function whaleMarkers(mint: string, sinceSec: number, minUsd = Number(process.env.WHALE_MIN_USD ?? 1000)) {
  if (!enabled()) return [];
  try {
    const r = await (await db()).query(`select signature, wallet, side, usd, extract(epoch from block_time)::bigint t from market_data.whale_swaps where mint = $1 and block_time >= to_timestamp($2) and usd >= $3 order by block_time limit 200`, [mint, sinceSec, minUsd]);
    return r.rows.map((x) => ({ time: Number(x.t), side: x.side as 'buy' | 'sell', usd: Number(x.usd), wallet: x.wallet, solscan: `https://solscan.io/tx/${x.signature}` }));
  } catch { return []; }
}
