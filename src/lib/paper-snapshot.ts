/**
 * Cletus paper (simulated) book, read from the sanitized Neon snapshot (schema paper_sim) that the box
 * publisher writes about once a minute from the isolated paper workers. Read-only role, no keys, no wallets.
 * Never fabricates numbers: anything missing stays null and the UI renders "—".
 */
export type PaperRow = {
  id: string; network: string; token: string; tokenAddress: string | null; status: 'open' | 'closed';
  entryPrice: number | null; currentPrice: number | null; exitPrice: number | null; sizeUsd: number | null;
  pnlUsd: number | null; pnlPct: number | null; exitReason: string | null; chartUrl: string | null;
  openedAt: string | null; closedAt: string | null;
};
export type PaperBook = { book: string; label: string; startingUsd: number | null; cashUsd: number | null; equityUsd: number | null; open: number | null; closed: number | null };
export type PaperNetwork = { network: string; open: number | null; closed: number | null; wins: number | null; pnlUsd: number | null };
export type PaperSnapshot = {
  available: boolean; simulated: true; mode: 'paper'; publishedAt: string | null; stale: boolean;
  startingUsd: number | null; equityUsd: number | null; totalPnlUsd: number | null; realizedUsd: number | null; unrealizedUsd: number | null;
  openCount: number; closedCount: number | null; wins: number | null; losses: number | null; winRatePct: number | null;
  books: PaperBook[]; networks: PaperNetwork[]; open: PaperRow[]; recent: PaperRow[]; reason?: string;
};

export const PAPER_STALE_MS = 5 * 60_000;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);
const iso = (v: unknown): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return null;
};
const safeUrl = (v: unknown): string | null => {
  const s = str(v); if (!s) return null;
  try { const u = new URL(s); return u.protocol === 'https:' && /(^|\.)(dexscreener\.com|geckoterminal\.com)$/.test(u.hostname) ? u.toString() : null; } catch { return null; }
};

export function emptySnapshot(reason: string): PaperSnapshot {
  return { available: false, simulated: true, mode: 'paper', publishedAt: null, stale: true, startingUsd: null, equityUsd: null, totalPnlUsd: null,
    realizedUsd: null, unrealizedUsd: null, openCount: 0, closedCount: 0, wins: 0, losses: 0, winRatePct: null, books: [], networks: [], open: [], recent: [], reason };
}

export function normalizeRow(r: Record<string, unknown>): PaperRow | null {
  const status = r.status === 'open' || r.status === 'closed' ? r.status : null;
  const id = str(r.id), token = str(r.token), network = str(r.network);
  if (!status || !id || !token || !network) return null;
  if (r.simulated === false) return null; // only simulated rows are ever shown
  return {
    id, network, token: token.slice(0, 32), tokenAddress: str(r.token_address), status,
    entryPrice: num(r.entry_price), currentPrice: num(r.current_price), exitPrice: num(r.exit_price), sizeUsd: num(r.size_usd),
    pnlUsd: num(r.pnl_usd), pnlPct: num(r.pnl_pct), exitReason: str(r.exit_reason), chartUrl: safeUrl(r.chart_url),
    openedAt: iso(r.opened_at), closedAt: iso(r.closed_at),
  };
}

/** Pure: build the public payload from the snapshot row + position rows. */
export function buildSnapshot(snap: { published_at: unknown; summary: unknown } | null, rows: Array<Record<string, unknown>>, now = Date.now()): PaperSnapshot {
  if (!snap) return emptySnapshot('no snapshot published yet');
  const s = (snap.summary && typeof snap.summary === 'object' ? snap.summary : {}) as Record<string, unknown>;
  if (s.simulated !== true) return emptySnapshot('snapshot is not marked simulated');
  const publishedAt = iso(snap.published_at);
  const all = rows.map(normalizeRow).filter((r): r is PaperRow => !!r);
  const open = all.filter((r) => r.status === 'open').sort((a, b) => (b.openedAt ?? '').localeCompare(a.openedAt ?? ''));
  const recent = all.filter((r) => r.status === 'closed').sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')).slice(0, 25);
  const books: PaperBook[] = Array.isArray(s.books) ? (s.books as Array<Record<string, unknown>>).map((b) => ({
    book: str(b.book) ?? 'book', label: str(b.label) ?? 'Book', startingUsd: num(b.startingUsd), cashUsd: num(b.cashUsd), equityUsd: num(b.equityUsd),
    open: num(b.open), closed: num(b.closed),
  })) : [];
  const networks: PaperNetwork[] = s.networks && typeof s.networks === 'object'
    ? Object.entries(s.networks as Record<string, Record<string, unknown>>).map(([network, v]) => ({ network, open: num(v.open), closed: num(v.closed), wins: num(v.wins), pnlUsd: num(v.pnlUsd) }))
    : [];
  const closedCount = num(s.closedCount); // never infer from the 25 most recent rows
  return {
    available: true, simulated: true, mode: 'paper', publishedAt,
    stale: !publishedAt || now - Date.parse(publishedAt) > PAPER_STALE_MS,
    startingUsd: num(s.startingUsd), equityUsd: num(s.equityUsd), totalPnlUsd: num(s.totalPnlUsd), realizedUsd: num(s.realizedUsd),
    unrealizedUsd: open.length ? num(s.unrealizedUsd) : null,
    openCount: num(s.openCount) ?? open.length, closedCount, wins: num(s.wins), losses: num(s.losses), winRatePct: num(s.winRatePct),
    books, networks, open, recent,
  };
}

/** Server-only. Reads the snapshot with the read-only role in PAPER_READ_DATABASE_URL. */
export async function loadPaperSnapshot(env: Record<string, string | undefined> = process.env): Promise<PaperSnapshot> {
  const url = env.PAPER_READ_DATABASE_URL;
  if (!url) return emptySnapshot('paper feed not configured');
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    const snaps = (await sql`select published_at, summary from paper_sim.paper_snapshot where id = 1 and mode = 'paper'`) as Array<{ published_at: unknown; summary: unknown }>;
    const rows = (await sql`select id, network, token, token_address, status, entry_price, current_price, exit_price, size_usd, pnl_usd, pnl_pct, exit_reason, chart_url, opened_at, closed_at, simulated
      from paper_sim.paper_positions where simulated = true order by coalesce(closed_at, opened_at) desc limit 200`) as Array<Record<string, unknown>>;
    return buildSnapshot(snaps[0] ?? null, rows);
  } catch {
    console.error('[paper-snapshot] read failed');
    return emptySnapshot('paper feed unavailable');
  }
}
