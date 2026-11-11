/**
 * Portfolio-level safety (pure; unit-tested). Runs before every entry, for every account.
 *  - max concurrent open positions (MAX_OPEN_POSITIONS, default 20)
 *  - total exposure cap (MAX_TOTAL_EXPOSURE_PERCENTAGE, default 60% of equity)
 *  - per-position cap (MAX_POSITION_PCT_OF_EQUITY, applied in sizing)
 *  - no duplicate tokens
 *  - max N open positions per correlated cluster: same narrative OR same dev/creator wallet (MAX_POSITIONS_PER_CLUSTER, default 3)
 */
export interface OpenPos { mint: string; sizeUsd: number; narrative?: string | null; creator?: string | null }
export interface PortfolioParams { maxOpenPositions: number; maxTotalExposurePct: number; maxPositionsPerCluster: number }

const NARRATIVES: Array<[string, RegExp]> = [
  ['cats', /\b(cat|kitty|kitten|meow|neko|popcat|mew)|cat\b/i],
  ['dogs', /\b(dog|doge|shib|inu|puppy|pup|wif|bonk)|dog\b/i],
  ['frogs', /\b(pepe|frog|toad|kek)/i],
  ['ai', /\b(ai|gpt|agent|bot|neural|llm|grok)\b|\bai[A-Z]/i],
  ['politics', /\b(trump|maga|biden|elon|vance|kamala|potus|president)/i],
  ['monkeys', /\b(ape|monke|monkey|chimp)/i],
  ['anime', /\b(anime|waifu|chan|kawaii)/i],
  ['food', /\b(pizza|burger|taco|sushi|banana|cheese)/i],
];

/** Heuristic narrative bucket from symbol + name (pure; unit-tested). Null = no known narrative. */
export function narrativeOf(symbol: string, name?: string | null): string | null {
  const s = `${symbol} ${name ?? ''}`;
  for (const [k, re] of NARRATIVES) if (re.test(s)) return k;
  return null;
}

export function portfolioCheck(open: OpenPos[], cand: { mint: string; sizeUsd: number; narrative: string | null; creator: string | null }, equityUsd: number, p: PortfolioParams): { allowed: boolean; maxSizeUsd: number; reasons: string[] } {
  const reasons: string[] = [];
  if (open.length >= p.maxOpenPositions) reasons.push(`max open positions ${open.length}/${p.maxOpenPositions}`);
  if (open.some((o) => o.mint === cand.mint)) reasons.push('duplicate token: already holding it');
  if (p.maxPositionsPerCluster > 0) {
    if (cand.narrative) {
      const n = open.filter((o) => o.narrative === cand.narrative).length;
      if (n >= p.maxPositionsPerCluster) reasons.push(`narrative "${cand.narrative}" already has ${n} open (max ${p.maxPositionsPerCluster})`);
    }
    if (cand.creator) {
      const n = open.filter((o) => o.creator && o.creator === cand.creator).length;
      if (n >= p.maxPositionsPerCluster) reasons.push(`dev wallet ${cand.creator.slice(0, 6)}… already has ${n} open (max ${p.maxPositionsPerCluster})`);
    }
  }
  const exposure = open.reduce((s, o) => s + o.sizeUsd, 0);
  const room = Math.max(0, (equityUsd * p.maxTotalExposurePct) / 100 - exposure);
  if (room <= 0) reasons.push(`total exposure cap ${p.maxTotalExposurePct}% reached`);
  const maxSizeUsd = Math.floor(Math.min(cand.sizeUsd, room) * 100) / 100;
  return { allowed: reasons.length === 0 && maxSizeUsd > 0, maxSizeUsd, reasons };
}

/** Run async tasks with bounded concurrency (used to monitor all open positions at once). */
export async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) { const x = items[i++]; try { await fn(x); } catch { /* per-item errors are logged by fn */ } }
  });
  await Promise.all(workers);
}
