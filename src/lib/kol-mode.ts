/**
 * KOL / pump.fun add-on mode (owner request, Nov 11 2026, 9:05 PM CT). KOL_MODE=on.
 * Runs ALONGSIDE the main $25k-$5M strategy with its own slot (KOL_MAX_OPEN, default 1), its own band
 * ($5k-$25k), its own gates and its own exits (+15% take profit selling 100%, -7% stop). Main-strategy
 * positions never get these exits and KOL positions never get the adaptive ones.
 *
 * Source: Solana contract addresses posted in the last KOL_WINDOW_MIN (30) minutes by the accounts in
 * KOL_ACCOUNTS (default seed list below, verified on X on Nov 11 2026), via the official X API v2 recent
 * search (X_BEARER_TOKEN), plus an optional inbox file (KOL_CALLOUTS_FILE, default data/kol-callouts.json)
 * that another sanctioned process can fill. Pure parts are unit-tested.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HARD_BOUNDS, type ExitBounds, type ExitPlan } from './adaptive-exits';

/** Seed list: well-known Solana memecoin KOLs, each handle verified to exist on X (Nov 11 2026). */
export const DEFAULT_KOLS = [
  'blknoiz06', 'MustStopMurad', 'Cupseyy', 'notthreadguy', 'frankdegods', 'orangie', 'CryptoGodJohn', 'Ga__ke',
  'Dior100x', 'gr3gor14n', 'theunipcs', 'Cented7', 'MarcellxMarcell', 'jidn_w', 'Loopierr', 'ShockedJS',
  'daumenxyz', 'Latuche95', 'waddles_eth', 'kreo444',
];

export interface KolConfig {
  enabled: boolean;
  accounts: string[];
  windowMin: number; pollSec: number; maxRequestsPerDay: number;
  minMcap: number; maxMcap: number; maxOpen: number;
  /** Scaled to the $5k-$25k band (main: $25k floor -> $1,500 5m vol, $10k buy vol, $50k liq). */
  minVol5mUsd: number; buyVolMinUsd: number; buyVolMcapPct: number; minLiquidityUsd: number; minVolume24hUsd: number;
  maxClusterPct: number; minHolders: number; maxDevPct: number; maxCreatorTokens: number;
  clusterFallback: 'off' | 'rugcheck';
  takeProfitPct: number; stopLossPct: number; staleMinutes: number; staleBandPct: number;
  callFile: string;
}

const num = (env: Record<string, string | undefined>, k: string, d: number) => { const v = env[k]; const x = Number(v); return v !== undefined && v.trim() !== '' && Number.isFinite(x) ? x : d; };

export function kolConfig(env: Record<string, string | undefined> = process.env): KolConfig {
  const accounts = (env.KOL_ACCOUNTS ?? '').split(',').map((s) => s.trim().replace(/^@/, '')).filter((s) => /^[A-Za-z0-9_]{1,15}$/.test(s));
  return {
    enabled: ['on', 'true', '1'].includes((env.KOL_MODE ?? '').trim().toLowerCase()),
    accounts: accounts.length ? [...new Set(accounts)] : DEFAULT_KOLS,
    windowMin: Math.min(240, Math.max(5, num(env, 'KOL_WINDOW_MIN', 30))),
    pollSec: Math.max(60, num(env, 'KOL_POLL_SEC', 300)),
    maxRequestsPerDay: Math.max(0, num(env, 'KOL_MAX_REQUESTS_PER_DAY', 300)),
    minMcap: num(env, 'KOL_MIN_MCAP', 5_000), maxMcap: num(env, 'KOL_MAX_MCAP', 25_000),
    maxOpen: Math.max(1, Math.min(3, num(env, 'KOL_MAX_OPEN', 1))),
    minVol5mUsd: num(env, 'KOL_MIN_VOL_5M_USD', 500),
    buyVolMinUsd: num(env, 'KOL_BUY_VOL_10M_USD', 1_000), buyVolMcapPct: num(env, 'KOL_BUY_VOL_10M_MCAP_PCT', 5),
    minLiquidityUsd: num(env, 'KOL_MIN_LIQUIDITY_USD', 2_500), minVolume24hUsd: num(env, 'KOL_MIN_VOLUME_24H_USD', 4_000),
    maxClusterPct: num(env, 'KOL_MAX_CLUSTER_PCT', 15), minHolders: num(env, 'KOL_MIN_HOLDERS', 150),
    maxDevPct: num(env, 'KOL_MAX_DEV_PCT', 10), maxCreatorTokens: num(env, 'KOL_MAX_CREATOR_TOKENS', 3),
    clusterFallback: (env.KOL_CLUSTER_FALLBACK ?? 'off').trim().toLowerCase() === 'rugcheck' ? 'rugcheck' : 'off',
    takeProfitPct: 15, stopLossPct: 7, staleMinutes: num(env, 'KOL_STALE_MINUTES', 60), staleBandPct: 3,
    callFile: env.KOL_CALLOUTS_FILE || path.join(process.cwd(), 'data', 'kol-callouts.json'),
  };
}

// ── Callouts ────────────────────────────────────────────────────────────────────────────────────

export interface Callout { mint: string; handle: string; postedAt: number; url: string | null }

const B58 = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;
const NOT_TOKENS = new Set([
  'So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  '11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
]);

/** Solana contract addresses in a post (base58, 32-44 chars, not part of a URL path we can't trust as a CA). */
export function extractSolanaMints(text: string): string[] {
  const out: string[] = [];
  for (const m of (text ?? '').match(B58) ?? []) {
    if (NOT_TOKENS.has(m) || out.includes(m)) continue;
    // Must contain both digits/letters mix typical of keys; reject pure-alpha words (e.g. long hashtags).
    if (!/[0-9]/.test(m) && !m.endsWith('pump')) continue;
    out.push(m);
  }
  return out;
}

/** X recent-search queries for the KOL list (chunked under the 512-char query limit). */
export function kolQueries(accounts: string[], maxLen = 480): string[] {
  const out: string[] = []; let cur: string[] = [];
  const q = (xs: string[]) => `(${xs.map((a) => `from:${a}`).join(' OR ')}) -is:retweet`;
  for (const a of accounts) {
    if (cur.length && q([...cur, a]).length > maxLen) { out.push(q(cur)); cur = []; }
    cur.push(a);
  }
  if (cur.length) out.push(q(cur));
  return out;
}

/** Parse an X v2 recent-search response into callouts (newest first, deduped by mint, within the window). */
export function calloutsFromSearch(json: unknown, nowMs: number, windowMin: number): Callout[] {
  const j = json as { data?: Array<{ id: string; text?: string; author_id?: string; created_at?: string; entities?: { urls?: Array<{ expanded_url?: string }> } }>; includes?: { users?: Array<{ id: string; username?: string }> } };
  const users = new Map((j?.includes?.users ?? []).map((u) => [u.id, u.username ?? u.id]));
  const out: Callout[] = [];
  for (const p of j?.data ?? []) {
    const at = p.created_at ? Date.parse(p.created_at) : NaN;
    if (!Number.isFinite(at) || nowMs - at > windowMin * 60_000) continue;
    const text = [p.text ?? '', ...(p.entities?.urls ?? []).map((u) => u.expanded_url ?? '')].join(' ');
    const handle = users.get(p.author_id ?? '') ?? p.author_id ?? '?';
    for (const mint of extractSolanaMints(text)) out.push({ mint, handle, postedAt: at, url: `https://x.com/${handle}/status/${p.id}` });
  }
  return dedupeCallouts(out);
}

export function dedupeCallouts(xs: Callout[]): Callout[] {
  const best = new Map<string, Callout>();
  for (const c of xs) { const b = best.get(c.mint); if (!b || c.postedAt > b.postedAt) best.set(c.mint, c); }
  return [...best.values()].sort((a, b) => b.postedAt - a.postedAt);
}

interface PollState { lastAt: number; day: string; used: number; backoffUntil: number; callouts: Callout[]; lastError: string | null }
const g = globalThis as unknown as { __kolPoll?: PollState };
const st: PollState = (g.__kolPoll ??= { lastAt: 0, day: '', used: 0, backoffUntil: 0, callouts: [], lastError: null });
export function kolStatus() { return { lastAt: st.lastAt, used: st.used, backoffUntil: st.backoffUntil, lastError: st.lastError, callouts: st.callouts.length }; }
export function _resetKolPoll() { Object.assign(st, { lastAt: 0, day: '', used: 0, backoffUntil: 0, callouts: [], lastError: null }); }

function readInbox(file: string, nowMs: number, windowMin: number): Callout[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ mint?: string; handle?: string; postedAt?: string | number; url?: string }>;
    return (Array.isArray(raw) ? raw : []).flatMap((r) => {
      const at = typeof r.postedAt === 'number' ? r.postedAt : Date.parse(String(r.postedAt ?? ''));
      const mints = extractSolanaMints(String(r.mint ?? ''));
      return Number.isFinite(at) && nowMs - at <= windowMin * 60_000 && mints.length ? [{ mint: mints[0], handle: String(r.handle ?? 'inbox'), postedAt: at, url: r.url ?? null }] : [];
    });
  } catch { return []; }
}

/**
 * Recent KOL callouts (X API, rate-limited to one round per KOL_POLL_SEC and KOL_MAX_REQUESTS_PER_DAY; 402/429 back
 * off for an hour) merged with the inbox file. Never throws.
 */
export async function fetchKolCallouts(cfg: KolConfig, nowMs = Date.now(), env: Record<string, string | undefined> = process.env): Promise<Callout[]> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  if (st.day !== day) { st.day = day; st.used = 0; }
  const token = (env.X_BEARER_TOKEN ?? '').trim();
  const queries = kolQueries(cfg.accounts);
  if (token && nowMs >= st.backoffUntil && nowMs - st.lastAt >= cfg.pollSec * 1000 && st.used + queries.length <= cfg.maxRequestsPerDay) {
    st.lastAt = nowMs;
    const fresh: Callout[] = [];
    const start = new Date(nowMs - cfg.windowMin * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    for (const q of queries) {
      st.used++;
      try {
        const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=100&start_time=${start}&tweet.fields=created_at,author_id,entities&expansions=author_id&user.fields=username`;
        const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000), cache: 'no-store' });
        if (res.status === 402 || res.status === 429) { st.backoffUntil = nowMs + 3_600_000; st.lastError = `X API HTTP ${res.status}${res.status === 402 ? ' (credits depleted)' : ''}`; break; }
        if (!res.ok) { st.lastError = `X API HTTP ${res.status}`; continue; }
        fresh.push(...calloutsFromSearch(await res.json(), nowMs, cfg.windowMin));
        st.lastError = null;
      } catch (e) { st.lastError = `X API: ${(e as Error).message}`; }
    }
    st.callouts = dedupeCallouts([...fresh, ...st.callouts]);
  }
  st.callouts = st.callouts.filter((c) => nowMs - c.postedAt <= cfg.windowMin * 60_000);
  return dedupeCallouts([...st.callouts, ...readInbox(cfg.callFile, nowMs, cfg.windowMin)]);
}

// ── Pre-buy gates ───────────────────────────────────────────────────────────────────────────────

export interface KolGateInput {
  /** RugCheck full report (holders, creator, launchpad, insider networks, risks). */
  report: {
    totalHolders?: number | null; creator?: string | null; creatorBalance?: number | null; token?: { supply?: number } | null;
    launchpad?: { name?: string; platform?: string; url?: string } | null; deployPlatform?: string | null;
    creatorTokens?: unknown[] | null; insiderNetworks?: Array<{ tokenAmount?: number; currentHolding?: number }> | null;
    risks?: Array<{ name: string; description?: string; level?: string }>;
  } | null;
  /** Bubblemaps: largest cluster share in % (null = no data / no key). */
  bubblemapsTopClusterPct: number | null;
  /** Token metadata JSON (createdOn, website, twitter, description) when readable. */
  metadata: Record<string, unknown> | null;
  /** On-chain holder count fallback. */
  holdersOnchain?: number | null;
}

export interface KolGateResult { pass: boolean; reasons: string[]; notes: string[]; clusterPct: number | null; clusterSource: 'bubblemaps' | 'rugcheck' | null; holders: number | null; devPct: number | null; rapidlaunch: boolean }

/** rapidlaunch.io heuristic: RugCheck launchpad/deploy platform, or metadata createdOn/website/socials/description mentioning it. */
export function isRapidLaunch(report: KolGateInput['report'], metadata: Record<string, unknown> | null): boolean {
  const hay = [
    report?.launchpad?.name, report?.launchpad?.platform, report?.launchpad?.url, report?.deployPlatform,
    ...(metadata ? ['createdOn', 'website', 'twitter', 'telegram', 'description', 'external_url'].map((k) => metadata[k]) : []),
  ].filter((x) => typeof x === 'string').join(' ').toLowerCase();
  return /rapid\s*launch|rapidlaunch/.test(hay);
}

/** Rugcheck insider-network share of supply (largest network, %): the cluster fallback when Bubblemaps is unavailable. */
export function rugcheckTopClusterPct(report: KolGateInput['report']): number | null {
  const supply = Number(report?.token?.supply);
  const nets = report?.insiderNetworks;
  if (!(supply > 0) || !Array.isArray(nets)) return null;
  if (!nets.length) return 0;
  return Math.max(...nets.map((n) => Number(n.currentHolding ?? n.tokenAmount ?? 0))) / supply * 100;
}

export function evaluateKolGates(inp: KolGateInput, cfg: KolConfig): KolGateResult {
  const reasons: string[] = []; const notes: string[] = [];
  const r = inp.report;
  if (!r) return { pass: false, reasons: ['RugCheck report unavailable'], notes, clusterPct: null, clusterSource: null, holders: null, devPct: null, rapidlaunch: false };
  // 1. Bubblemaps clusters (required; RugCheck insider networks only when KOL_CLUSTER_FALLBACK=rugcheck).
  let clusterPct = inp.bubblemapsTopClusterPct; let clusterSource: KolGateResult['clusterSource'] = clusterPct != null ? 'bubblemaps' : null;
  if (clusterPct == null && cfg.clusterFallback === 'rugcheck') { clusterPct = rugcheckTopClusterPct(r); clusterSource = clusterPct != null ? 'rugcheck' : null; }
  if (clusterPct == null) reasons.push('Bubblemaps cluster data unavailable');
  else if (clusterPct > cfg.maxClusterPct) reasons.push(`top connected cluster ${clusterPct.toFixed(1)}% > ${cfg.maxClusterPct}% (${clusterSource})`);
  else notes.push(`cluster ${clusterPct.toFixed(1)}% (${clusterSource})`);
  // 2. Holder count.
  const holders = Number.isFinite(Number(r.totalHolders)) && Number(r.totalHolders) > 0 ? Number(r.totalHolders) : (inp.holdersOnchain ?? null);
  if (holders == null) reasons.push('holder count unknown');
  else if (holders < cfg.minHolders) reasons.push(`holders ${holders} < ${cfg.minHolders}`);
  else notes.push(`${holders} holders`);
  // 3. rapidlaunch.io: rejected; metadata must be readable to rule it out.
  const rapid = isRapidLaunch(r, inp.metadata);
  if (rapid) reasons.push('launched via rapidlaunch.io');
  else if (!inp.metadata) reasons.push('token metadata unreadable (cannot rule out rapidlaunch.io)');
  // 4. Dev wallet.
  const supply = Number(r.token?.supply);
  const devPct = supply > 0 && Number.isFinite(Number(r.creatorBalance)) ? (Number(r.creatorBalance) / supply) * 100 : null;
  if (!r.creator) reasons.push('creator unknown');
  if (devPct != null && devPct > cfg.maxDevPct) reasons.push(`dev holds ${devPct.toFixed(1)}% > ${cfg.maxDevPct}%`);
  const serial = Array.isArray(r.creatorTokens) ? r.creatorTokens.length : 0;
  if (serial > cfg.maxCreatorTokens) reasons.push(`serial launcher: creator made ${serial} other tokens`);
  const devRisk = (r.risks ?? []).filter((x) => /(creator|dev|deployer)/i.test(`${x.name} ${x.description ?? ''}`) && /(rug|sold|sell|dump|history)/i.test(`${x.name} ${x.description ?? ''}`));
  if (devRisk.length) reasons.push(`dev risk: ${devRisk.map((x) => x.name).join('; ')}`);
  if (devPct != null) notes.push(`dev ${devPct.toFixed(1)}%`);
  return { pass: reasons.length === 0, reasons, notes, clusterPct, clusterSource, holders, devPct, rapidlaunch: rapid };
}

// ── Exits ───────────────────────────────────────────────────────────────────────────────────────

export const KOL_PLAN_TAG = 'mode:kol';
/** KOL bounds: Cletus chose a 7% stop for this mode only (main mode keeps the 8% minimum). */
export const KOL_BOUNDS: ExitBounds = { ...HARD_BOUNDS, minStopPct: 7 };
export const isKolPlan = (p: Pick<ExitPlan, 'notes'> | null | undefined) => !!p?.notes?.includes(KOL_PLAN_TAG);

export function kolExitPlan(cfg: KolConfig, score: number, liquidityUsd: number | null): ExitPlan {
  return {
    version: 1, stopLossPct: cfg.stopLossPct,
    // No partial: take profit sells 100% at +15%. Partial fields mirror the target (the ladder is cleared for KOL plans).
    partialGainPct: cfg.takeProfitPct, partialSellPct: 60, breakEvenTriggerPct: 1e9, trailingArmPct: 1e9, trailingStopPct: 5,
    takeProfitPct: cfg.takeProfitPct, stalePositionMinutes: cfg.staleMinutes, staleBandPct: cfg.staleBandPct,
    volPctPerHour: 0, regime: 'neutral', learnedFrom: 0, score, liquidityUsd, notes: [KOL_PLAN_TAG, 'KOL callout: +15% take (100%), -7% stop'],
  };
}

export function kolPlanValid(p: ExitPlan): boolean {
  return isKolPlan(p) && p.stopLossPct >= KOL_BOUNDS.minStopPct && p.stopLossPct <= KOL_BOUNDS.maxStopPct && p.takeProfitPct > 0 && p.takeProfitPct <= KOL_BOUNDS.maxFinalPct;
}

/** Config overrides for a KOL position: whole position out at the target, no ladder, no break-even, no trail. */
export function kolOverrides(p: ExitPlan) {
  return {
    stopLossPct: p.stopLossPct, takeProfitPct: p.takeProfitPct, tpLadder: [] as Array<{ gainPct: number; sellPct: number }>,
    breakEvenTriggerPct: 1e9, trailingArmPct: 1e9, trailingStopPct: p.trailingStopPct, enableTrailingStop: false as const,
    stalePositionMinutes: p.stalePositionMinutes, staleBandPct: p.staleBandPct,
  };
}

/** Token metadata JSON (pump.fun style: createdOn, website, twitter, description). ipfs.io links go via the Pinata gateway. */
export async function fetchTokenMetadata(uri: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!uri || !/^https?:\/\//.test(uri)) return null;
  const url = uri.replace(/^https?:\/\/(ipfs\.io|dweb\.link|cloudflare-ipfs\.com)\/ipfs\//, 'https://gateway.pinata.cloud/ipfs/');
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
  } catch { return null; }
}
