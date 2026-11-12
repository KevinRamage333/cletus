/**
 * Bubblemaps Data API (https://docs.bubblemaps.io): largest connected cluster share for a Solana token.
 * Needs BUBBLEMAPS_API_KEY (sent as the X-ApiKey header); without it returns null (= data unavailable).
 * The legacy keyless endpoint (api-legacy.bubblemaps.io/map-availability) only says whether a map exists.
 */
export interface BubbleCluster { share?: number; amount?: number; holder_count?: number }

/** Largest cluster share in % (API shares are 0-1 fractions; values > 1 are treated as already %). */
export function topClusterPct(json: unknown): number | null {
  const cl = (json as { clusters?: BubbleCluster[] | null })?.clusters;
  if (!Array.isArray(cl)) return null;
  if (!cl.length) return 0;
  const m = Math.max(...cl.map((c) => Number(c.share ?? 0)).filter(Number.isFinite));
  return m <= 1 ? m * 100 : m;
}

const cache = new Map<string, { at: number; v: number | null }>();
export async function bubblemapsTopClusterPct(mint: string, env: Record<string, string | undefined> = process.env): Promise<number | null> {
  const key = (env.BUBBLEMAPS_API_KEY ?? '').trim();
  if (!key) return null;
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
  try {
    const res = await fetch(`https://api.bubblemaps.io/v0/tokens/map/solana/${mint}?limit=80&return_clusters=true`, { headers: { 'X-ApiKey': key, accept: 'application/json' }, signal: AbortSignal.timeout(12_000), cache: 'no-store' });
    const v = res.ok ? topClusterPct(await res.json()) : null;
    cache.set(mint, { at: Date.now(), v });
    return v;
  } catch { return null; }
}
