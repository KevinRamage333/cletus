/**
 * Free "hype" sources for KOL mode (replaces paid X polling, owner request Nov 12):
 *  - DexScreener token boosts (latest + top), Solana only
 *  - pump.fun frontend API: king-of-the-hill + currently-live (Cloudflare often blocks servers; reported, never fatal)
 *  - GeckoTerminal: Solana trending pools (5m) on pump.fun / PumpSwap, plus top pump.fun bonding-curve pools
 *  - Phantom trending filtered to the KOL band
 * Output is the same Callout shape as X callouts (handle = "hype:<sources>"), so every KOL gate and exit applies unchanged.
 * Polled at most every KOL_HYPE_POLL_SEC (default 120 s); each source fails independently.
 */
import type { Callout } from './kol-mode';

export type HypeSource = 'boost-latest' | 'boost-top' | 'pump-koth' | 'pump-live' | 'gecko-pump' | 'phantom';
export interface HypeHit { mint: string; source: HypeSource; mcapUsd: number | null }
export interface HypeStatus { at: number; counts: Partial<Record<HypeSource, number>>; errors: Partial<Record<HypeSource, string>>; mints: number }

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PUMP_DEXES = new Set(['pump-fun', 'pumpswap']);

// ── pure parsers ───────────────────────────────────────────────────────────────
export function parseBoosts(j: unknown, source: 'boost-latest' | 'boost-top'): HypeHit[] {
  if (!Array.isArray(j)) return [];
  return j.flatMap((x: { chainId?: string; tokenAddress?: string }) => (x?.chainId === 'solana' && MINT.test(String(x.tokenAddress ?? '')) ? [{ mint: String(x.tokenAddress), source, mcapUsd: null }] : []));
}

export function parsePumpCoins(j: unknown, source: 'pump-koth' | 'pump-live'): HypeHit[] {
  const arr = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : [];
  return arr.flatMap((x: { mint?: string; usd_market_cap?: number; complete?: boolean }) =>
    MINT.test(String(x?.mint ?? '')) ? [{ mint: String(x.mint), source, mcapUsd: Number.isFinite(Number(x.usd_market_cap)) ? Number(x.usd_market_cap) : null }] : []);
}

type GeckoPool = { attributes?: { market_cap_usd?: string | null; fdv_usd?: string | null }; relationships?: { base_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } } };
export function parseGeckoPools(j: unknown, onlyPumpDex = true): HypeHit[] {
  const data = (j as { data?: GeckoPool[] })?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((p) => {
    const dex = p.relationships?.dex?.data?.id ?? '';
    if (onlyPumpDex && !PUMP_DEXES.has(dex)) return [];
    const mint = String(p.relationships?.base_token?.data?.id ?? '').replace(/^solana_/, '');
    if (!MINT.test(mint)) return [];
    const m = Number(p.attributes?.market_cap_usd ?? p.attributes?.fdv_usd);
    return [{ mint, source: 'gecko-pump' as const, mcapUsd: Number.isFinite(m) && m > 0 ? m : null }];
  });
}

/** Keep hits whose known market cap is near the band (0.5x min .. 2x max); unknown caps pass (DexScreener re-checks). */
export function nearBand(h: HypeHit, band: { min: number; max: number }): boolean {
  return h.mcapUsd == null || (h.mcapUsd >= band.min * 0.5 && h.mcapUsd <= band.max * 2);
}

/** Merge hits into Callouts (one per mint, handle lists every source), capped. */
export function hitsToCallouts(hits: HypeHit[], band: { min: number; max: number }, nowMs: number, cap = 90): Callout[] {
  const by = new Map<string, Set<HypeSource>>();
  for (const h of hits) { if (!nearBand(h, band)) continue; const s = by.get(h.mint) ?? new Set(); s.add(h.source); by.set(h.mint, s); }
  // Mints flagged by more sources first.
  return [...by.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, cap)
    .map(([mint, s]) => ({ mint, handle: `hype:${[...s].join('+')}`, postedAt: nowMs, url: null }));
}

// ── fetching ──────────────────────────────────────────────────────────────────
async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<unknown> {
  const https = await import('node:https');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', ...headers }, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { body += c; if (body.length > 3_000_000) req.destroy(new Error('response too large')); });
      res.on('end', () => {
        if ((res.statusCode ?? 0) !== 200) return reject(new Error(`HTTP ${res.statusCode}${/cloudflare|cf_chl/i.test(body) ? ' (Cloudflare block)' : ''}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('not JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const PUMP_HDR = { origin: 'https://pump.fun', referer: 'https://pump.fun/' };
const g = globalThis as unknown as { __kolHype?: { at: number; callouts: Callout[]; status: HypeStatus; pumpBlockedUntil: number } };
const st = (g.__kolHype ??= { at: 0, callouts: [], status: { at: 0, counts: {}, errors: {}, mints: 0 }, pumpBlockedUntil: 0 });
export function hypeStatus(): HypeStatus { return st.status; }
export function _resetHype() { Object.assign(st, { at: 0, callouts: [], status: { at: 0, counts: {}, errors: {}, mints: 0 }, pumpBlockedUntil: 0 }); }

export interface HypeDeps { getJson: (url: string, headers?: Record<string, string>) => Promise<unknown>; phantom: (band: { min: number; max: number }) => Promise<string[]> }
const defaultDeps: HypeDeps = {
  getJson,
  phantom: async (band) => (await (await import('./phantom')).fetchPhantomTrendingMints({ band })).mints,
};

export async function fetchHypeCallouts(band: { min: number; max: number }, nowMs = Date.now(), env: Record<string, string | undefined> = process.env, deps: HypeDeps = defaultDeps): Promise<Callout[]> {
  const pollMs = Math.max(30, Number(env.KOL_HYPE_POLL_SEC ?? 120) || 120) * 1000;
  if (st.at && nowMs - st.at < pollMs) return st.callouts;
  st.at = nowMs;
  const counts: HypeStatus['counts'] = {}; const errors: HypeStatus['errors'] = {};
  const run = async (src: HypeSource, f: () => Promise<HypeHit[]>): Promise<HypeHit[]> => {
    try { const h = await f(); counts[src] = h.length; return h; } catch (e) { errors[src] = (e as Error).message.slice(0, 80); return []; }
  };
  const usePump = (env.KOL_HYPE_PUMPFUN ?? 'on') !== 'off' && nowMs >= st.pumpBlockedUntil;
  const usePhantom = (env.KOL_HYPE_PHANTOM ?? 'on') !== 'off';
  const parts = await Promise.all([
    run('boost-latest', async () => parseBoosts(await deps.getJson('https://api.dexscreener.com/token-boosts/latest/v1'), 'boost-latest')),
    run('boost-top', async () => parseBoosts(await deps.getJson('https://api.dexscreener.com/token-boosts/top/v1'), 'boost-top')),
    usePump ? run('pump-koth', async () => parsePumpCoins(await deps.getJson('https://frontend-api-v3.pump.fun/coins/king-of-the-hill?includeNsfw=false', PUMP_HDR), 'pump-koth')) : Promise.resolve([]),
    usePump ? run('pump-live', async () => parsePumpCoins(await deps.getJson('https://frontend-api-v3.pump.fun/coins/currently-live?limit=50&offset=0&includeNsfw=false', PUMP_HDR), 'pump-live')) : Promise.resolve([]),
    run('gecko-pump', async () => {
      const [a, b] = await Promise.allSettled([
        deps.getJson('https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?duration=5m&page=1'),
        deps.getJson('https://api.geckoterminal.com/api/v2/networks/solana/dexes/pump-fun/pools?sort=h24_volume_usd_desc&page=1'),
      ]);
      if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
      return [...(a.status === 'fulfilled' ? parseGeckoPools(a.value) : []), ...(b.status === 'fulfilled' ? parseGeckoPools(b.value) : [])];
    }),
    usePhantom ? run('phantom', async () => (await deps.phantom(band)).map((mint) => ({ mint, source: 'phantom' as const, mcapUsd: null }))) : Promise.resolve([]),
  ]);
  // pump.fun Cloudflare-blocks most servers: after a block, retry every 30 min instead of every poll.
  if (/403|Cloudflare/.test(`${errors['pump-koth'] ?? ''}${errors['pump-live'] ?? ''}`) && !counts['pump-koth'] && !counts['pump-live']) st.pumpBlockedUntil = nowMs + 30 * 60_000;
  if (!usePump && st.pumpBlockedUntil > nowMs) errors['pump-koth'] = 'blocked (Cloudflare), retry later';
  st.callouts = hitsToCallouts(parts.flat(), band, nowMs);
  st.status = { at: nowMs, counts, errors, mints: st.callouts.length };
  return st.callouts;
}

export function describeHype(s: HypeStatus = st.status): string {
  const c = Object.entries(s.counts).map(([k, v]) => `${k} ${v}`).join(', ');
  const e = Object.entries(s.errors).map(([k, v]) => `${k} ${v}`).join(', ');
  return `hype ${s.mints} mint(s)${c ? ` (${c})` : ''}${e ? `; down: ${e}` : ''}`;
}

// ── last KOL round, for the owner desk ─────────────────────────────────────────────
export interface KolRoundRow { mint: string; symbol: string; mcapUsd: number | null; via: string; decision: string; reason: string }
const round = ((g as unknown as { __kolRound?: { at: string | null; summary: string; rows: KolRoundRow[] } }).__kolRound ??= { at: null, summary: '', rows: [] });
export function setKolRound(summary: string, rows: KolRoundRow[], at = new Date().toISOString()) { round.at = at; round.summary = summary; round.rows = rows.slice(0, 40); }
export function getKolRound() { return { ...round, rows: [...round.rows] }; }
