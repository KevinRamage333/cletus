/**
 * X (Twitter) hype features from the official X API v2 (recent search + recent counts) — never scraped from x.com.
 * Pure parts are unit-tested; the collector is in ./collector.ts and only runs when X_BEARER_TOKEN is set.
 * Hype is a CONFIRMER or VETO next to order flow, never a standalone buy trigger.
 */
export const X_API = 'https://api.x.com/2';

export function xConfig(env: Record<string, string | undefined> = process.env) {
  const t = (env.X_BEARER_TOKEN ?? env.TWITTER_BEARER_TOKEN ?? '').trim();
  const token = t && !t.startsWith('your_') ? t : null;
  const n = (k: string, d: number) => { const v = Number(env[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
  return {
    token, enabled: !!token && env.X_COLLECTOR !== 'off',
    maxRequestsPerDay: n('X_MAX_REQUESTS_PER_DAY', 300),   // counts + search calls combined
    perTokenIntervalMin: n('X_PER_TOKEN_INTERVAL_MIN', 15),
    tokensPerTick: n('X_TOKENS_PER_TICK', 2),
    searchSample: Math.min(100, Math.max(10, n('X_SEARCH_SAMPLE', 50))), // posts read per author-quality sample
  };
}

/** Recent-search query for a token: cashtag (when the symbol is a valid cashtag) OR the contract address. Retweets excluded. */
export function buildQuery(symbol: string | null | undefined, mint: string): string {
  const sym = (symbol ?? '').replace(/^\$/, '').trim();
  const parts = [mint];
  if (/^[A-Za-z][A-Za-z0-9_]{0,9}$/.test(sym)) parts.unshift(`$${sym}`);
  return `(${parts.join(' OR ')}) -is:retweet`;
}

export interface CountBucket { start: number; end: number; count: number } // unix seconds
export function parseCounts(json: unknown): CountBucket[] {
  const d = (json as { data?: Array<{ start: string; end: string; tweet_count: number }> })?.data ?? [];
  return d.map((b) => ({ start: Date.parse(b.start) / 1000, end: Date.parse(b.end) / 1000, count: Number(b.tweet_count) || 0 })).filter((b) => Number.isFinite(b.start)).sort((a, b) => a.start - b.start);
}

export interface AuthorSample { posts: number; uniqueAuthors: number; reach: number; botShare: number; dupShare: number; newAccountShare: number; organicRatio: number; topAuthors: Array<{ username: string; followers: number }> }

/** Bot-like / shill heuristics: brand-new account, tiny following, follow-spam ratio, or copy-pasted text. */
export function isBotLike(u: { created_at?: string; public_metrics?: { followers_count?: number; following_count?: number; tweet_count?: number } }, nowMs: number): boolean {
  const f = u.public_metrics?.followers_count ?? 0, fo = u.public_metrics?.following_count ?? 0;
  const ageDays = u.created_at ? (nowMs - Date.parse(u.created_at)) / 86_400_000 : 9999;
  return ageDays < 30 || f < 25 || (fo > 10 * Math.max(1, f) && f < 200);
}
const norm = (t: string) => t.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[@#$]\w+/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function authorSample(json: unknown, nowMs = Date.now()): AuthorSample {
  const j = json as { data?: Array<{ author_id: string; text?: string }>; includes?: { users?: Array<{ id: string; username?: string; created_at?: string; public_metrics?: { followers_count?: number; following_count?: number } }> } };
  const posts = j?.data ?? []; const users = new Map((j?.includes?.users ?? []).map((u) => [u.id, u]));
  const authors = [...new Set(posts.map((p) => p.author_id))];
  const texts = new Map<string, number>(); for (const p of posts) { const k = norm(p.text ?? ''); if (k.length > 8) texts.set(k, (texts.get(k) ?? 0) + 1); }
  const dup = [...texts.values()].filter((c) => c > 1).reduce((a, c) => a + c, 0);
  const bots = authors.filter((a) => { const u = users.get(a); return u ? isBotLike(u, nowMs) : false; });
  const fresh = authors.filter((a) => { const u = users.get(a); return u?.created_at ? (nowMs - Date.parse(u.created_at)) / 86_400_000 < 30 : false; });
  const reach = authors.reduce((s, a) => s + Math.log10(1 + (users.get(a)?.public_metrics?.followers_count ?? 0)), 0);
  const botShare = authors.length ? bots.length / authors.length : 0, dupShare = posts.length ? dup / posts.length : 0;
  return {
    posts: posts.length, uniqueAuthors: authors.length, reach, botShare, dupShare, newAccountShare: authors.length ? fresh.length / authors.length : 0,
    organicRatio: Math.max(0, 1 - Math.max(botShare, dupShare)),
    topAuthors: authors.map((a) => ({ username: users.get(a)?.username ?? a, followers: users.get(a)?.public_metrics?.followers_count ?? 0 })).sort((x, y) => y.followers - x.followers).slice(0, 5),
  };
}

export interface HypeFeatures { posts15m: number; posts1h: number; postsPrev1h: number; velocityPerHour: number; accel15m: number | null; accel1h: number | null }
/** Mention velocity and acceleration from per-minute or per-15m count buckets, using only buckets ending at or before `nowSec`. */
export function hypeFeatures(buckets: CountBucket[], nowSec: number): HypeFeatures {
  const past = buckets.filter((b) => b.end <= nowSec);
  const sumIn = (from: number, to: number) => past.filter((b) => b.start >= from && b.end <= to).reduce((a, b) => a + b.count, 0);
  const p15 = sumIn(nowSec - 900, nowSec), p1h = sumIn(nowSec - 3600, nowSec), prev = sumIn(nowSec - 7200, nowSec - 3600);
  const prior45 = sumIn(nowSec - 3600, nowSec - 900);
  return { posts15m: p15, posts1h: p1h, postsPrev1h: prev, velocityPerHour: p1h, accel15m: prior45 > 0 ? p15 / (prior45 / 3) : p15 > 0 ? null : 0, accel1h: prev > 0 ? p1h / prev : p1h > 0 ? null : 0 };
}

export type Divergence = 'exit_liquidity' | 'knife' | 'confirmed' | 'early_move' | 'shill' | 'neutral' | 'no_data';
export interface FlowView { priceChangeM5?: number; priceChangeH1?: number; buyRatio5m?: number | null; buyRatio1h?: number | null }

/** Hype vs price / order-flow divergence. Rising hype on falling price or sell-dominant flow = hype used as exit liquidity. */
export function hypeDivergence(h: HypeFeatures | null, a: AuthorSample | null, f: FlowView): { kind: Divergence; message: string } {
  if (!h) return { kind: 'no_data', message: 'No X mention data for this token yet.' };
  const accel = h.accel1h ?? (h.posts1h >= 10 ? 10 : 0), rising = accel >= 2 && h.posts1h >= 10;
  const sells = (f.buyRatio5m ?? f.buyRatio1h ?? 0.5) < 0.45, buys = (f.buyRatio5m ?? f.buyRatio1h ?? 0.5) > 0.55;
  const p1 = f.priceChangeH1 ?? 0;
  const xs = `X mentions ${h.accel1h === null ? 'appeared' : `${accel.toFixed(1)}x`} in 1h (${h.posts1h} posts)`;
  if (rising && a && a.organicRatio < 0.4) return { kind: 'shill', message: `${xs}, but ${(100 - a.organicRatio * 100).toFixed(0)}% look bot-like or copy-pasted: coordinated shilling.` };
  if (rising && (sells || p1 < -5)) return { kind: p1 < -15 ? 'knife' : 'exit_liquidity', message: `${xs} but ${sells ? 'sells dominate' : `price is ${p1.toFixed(1)}% in 1h`}: hype is being used as exit liquidity.` };
  if (rising && buys && p1 > 0) return { kind: 'confirmed', message: `${xs} with buy-side flow and price up ${p1.toFixed(1)}%: hype confirms the move.` };
  if (!rising && p1 > 10 && buys) return { kind: 'early_move', message: `Price up ${p1.toFixed(1)}% on buy flow before X hype (${h.posts1h} posts in 1h): an early move.` };
  return { kind: 'neutral', message: `${h.posts1h} X posts in 1h${h.accel1h ? ` (${h.accel1h.toFixed(1)}x prior hour)` : ''}; no divergence.` };
}

/** Confirmer / veto only. */
export function hypeGate(d: { kind: Divergence }): { veto: boolean; confirm: boolean } {
  return { veto: d.kind === 'exit_liquidity' || d.kind === 'knife' || d.kind === 'shill', confirm: d.kind === 'confirmed' };
}
