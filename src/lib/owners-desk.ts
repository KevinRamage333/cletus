/**
 * The Owner's Desk: read-only views of Neon-synced box files, build progress,
 * and paper-trading results. Pure helpers live here so tests do not need a DB.
 */
export const OWNERS_DESK_TITLE = "The Owner's Desk";
export const PAPER_STARTING_CAPITAL_USD = 150;

export function isSafeBoxPath(path: string | null | undefined): path is string {
  if (!path || typeof path !== 'string') return false;
  if (!path.startsWith('/workspace/')) return false;
  if (path.includes('..') || path.includes('\0') || path.includes('\\')) return false;
  if (path.length > 512) return false;
  return true;
}

export type BuildProgressRow = {
  id: number;
  savedAt: string;
  workstream: string;
  gitRef: string | null;
  summary: string;
};

export type SyncedDoc = {
  path: string;
  workstream: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  modifiedAt: string | null;
  syncedAt: string | null;
};

export type SyncedImage = {
  path: string;
  workstream: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  hasImage: boolean;
  modifiedAt: string | null;
  syncedAt: string | null;
  src: string;
};

export type PaperTrade = {
  source: string;
  network: string;
  token: string;
  status: 'open' | 'closed';
  pnlUsd: number | null;
  pnlPct: number | null;
  sizeUsd: number | null;
  openedAt: string | null;
  closedAt: string | null;
  exitReason: string | null;
};

export type PaperDesk = {
  startingCapitalUsd: number;
  equityUsd: number | null;
  cashUsd: number | null;
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
  pnlVsStartUsd: number | null;
  pnlVsStartPct: number | null;
  openCount: number;
  closedCount: number;
  winCount: number;
  winRatePct: number | null;
  trades: PaperTrade[];
  source: 'paper_snapshot' | 'paper_positions' | 'synced_files' | 'empty';
  publishedAt: string | null;
  empty: boolean;
  emptyMessage: string;
};

export const PAPER_EMPTY_MESSAGE =
  'No paper trades yet. The $150 simulation book is waiting for its first real trade.';

export type OwnersDeskPayload = {
  title: string;
  progress: BuildProgressRow[];
  latestProgress: BuildProgressRow | null;
  paper: PaperDesk;
  docs: SyncedDoc[];
  images: SyncedImage[];
};

export function emptyPaperDesk(): PaperDesk {
  return {
    startingCapitalUsd: PAPER_STARTING_CAPITAL_USD,
    equityUsd: PAPER_STARTING_CAPITAL_USD,
    cashUsd: PAPER_STARTING_CAPITAL_USD,
    realizedPnlUsd: null,
    unrealizedPnlUsd: null,
    pnlVsStartUsd: 0,
    pnlVsStartPct: 0,
    openCount: 0,
    closedCount: 0,
    winCount: 0,
    winRatePct: null,
    trades: [],
    source: 'empty',
    publishedAt: null,
    empty: true,
    emptyMessage: PAPER_EMPTY_MESSAGE,
  };
}

export function emptyOwnersDesk(): OwnersDeskPayload {
  return {
    title: OWNERS_DESK_TITLE,
    progress: [],
    latestProgress: null,
    paper: emptyPaperDesk(),
    docs: [],
    images: [],
  };
}

export function searchDocs(docs: SyncedDoc[], query: string): SyncedDoc[] {
  const q = query.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter((d) => {
    const hay = `${d.path} ${d.workstream ?? ''}`.toLowerCase();
    return hay.includes(q);
  });
}

export function filterDocsByContent(docs: SyncedDoc[], contents: Record<string, string>, query: string): SyncedDoc[] {
  const q = query.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter((d) => {
    const hay = `${d.path} ${d.workstream ?? ''} ${contents[d.path] ?? ''}`.toLowerCase();
    return hay.includes(q);
  });
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v;
  return null;
}

export function finalizePaperDesk(partial: Omit<PaperDesk, 'pnlVsStartUsd' | 'pnlVsStartPct' | 'empty' | 'emptyMessage' | 'winCount' | 'winRatePct' | 'startingCapitalUsd'> & {
  startingCapitalUsd?: number;
  winCount?: number;
  winRatePct?: number | null;
}): PaperDesk {
  const start = partial.startingCapitalUsd ?? PAPER_STARTING_CAPITAL_USD;
  const closed = partial.trades.filter((t) => t.status === 'closed');
  const winCount = partial.winCount ?? closed.filter((t) => (t.pnlUsd ?? 0) > 0).length;
  const winRatePct =
    partial.winRatePct !== undefined
      ? partial.winRatePct
      : closed.length
        ? (100 * winCount) / closed.length
        : null;
  const equity = partial.equityUsd;
  const pnlVsStartUsd = equity == null ? null : equity - start;
  const pnlVsStartPct = equity == null ? null : ((equity - start) / start) * 100;
  const empty = partial.openCount === 0 && partial.closedCount === 0 && partial.trades.length === 0
    && (partial.source === 'empty' || (partial.realizedPnlUsd == null && partial.unrealizedPnlUsd == null && (equity == null || equity === start)));
  return {
    ...partial,
    startingCapitalUsd: start,
    winCount,
    winRatePct,
    pnlVsStartUsd,
    pnlVsStartPct,
    empty,
    emptyMessage: PAPER_EMPTY_MESSAGE,
  };
}

/** EVM paper worker state at logs/evm-paper-state.json */
export function paperFromEvmState(state: unknown, tradesJsonl?: string | null, publishedAt?: string | null): PaperDesk | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as Record<string, unknown>;
  const cashUsd = num(s.cashUsd);
  const open = Array.isArray(s.open) ? s.open : [];
  const trades: PaperTrade[] = [];
  let unrealized = 0;
  let openValue = 0;
  for (const raw of open) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const entry = num(p.entryPrice);
    const last = num(p.last) ?? entry;
    const units = num(p.units);
    const costLeft = num(p.costLeft) ?? num(p.sizeUsd);
    let uPnl: number | null = null;
    let uPct: number | null = null;
    if (units != null && last != null) {
      const value = units * last;
      openValue += value;
      if (costLeft != null) uPnl = value - costLeft;
    } else if (costLeft != null && last != null && entry) {
      uPct = (last / entry - 1) * 100;
      uPnl = costLeft * (last / entry - 1);
      openValue += costLeft + uPnl;
    }
    if (uPnl != null) unrealized += uPnl;
    if (uPct == null && entry && last != null) uPct = (last / entry - 1) * 100;
    trades.push({
      source: 'evm-paper-state',
      network: str(p.chain) ?? 'evm',
      token: str(p.symbol) ?? 'unknown',
      status: 'open',
      pnlUsd: uPnl,
      pnlPct: uPct,
      sizeUsd: costLeft ?? num(p.sizeUsd),
      openedAt: str(p.openedAt),
      closedAt: null,
      exitReason: null,
    });
  }
  const closedFromJsonl = tradesJsonl ? paperTradesFromJsonl(tradesJsonl, 'evm-paper-trades') : [];
  const closed = closedFromJsonl.filter((t) => t.status === 'closed');
  const realized = closed.reduce((a, t) => a + (t.pnlUsd ?? 0), 0);
  const closedCount = num(s.closedCount) ?? closed.length;
  const equityUsd = cashUsd != null ? cashUsd + openValue : null;
  if (cashUsd == null && !open.length && !closed.length) return null;
  return finalizePaperDesk({
    source: 'synced_files',
    publishedAt: publishedAt ?? null,
    cashUsd,
    equityUsd,
    realizedPnlUsd: closed.length ? realized : null,
    unrealizedPnlUsd: open.length ? unrealized : null,
    openCount: open.length,
    closedCount,
    trades: [...trades, ...closed],
  });
}

export function paperTradesFromJsonl(text: string, source: string): PaperTrade[] {
  const out: PaperTrade[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const event = str(ev.event) ?? '';
    if (event === 'open' || event === 'entry') {
      out.push({
        source,
        network: str(ev.network) ?? str(ev.book) ?? 'unknown',
        token: str(ev.token) ?? str(ev.symbol) ?? 'unknown',
        status: 'open',
        pnlUsd: num(ev.pnlUsd),
        pnlPct: num(ev.pnlPct),
        sizeUsd: num(ev.sizeUsd),
        openedAt: str(ev.ts) ?? str(ev.at) ?? str(ev.openedAt),
        closedAt: null,
        exitReason: null,
      });
    } else if (event === 'close' || event === 'exit') {
      out.push({
        source,
        network: str(ev.network) ?? str(ev.book) ?? 'unknown',
        token: str(ev.token) ?? str(ev.symbol) ?? 'unknown',
        status: 'closed',
        pnlUsd: num(ev.pnlUsd),
        pnlPct: num(ev.pnlPct),
        sizeUsd: num(ev.sizeUsd),
        openedAt: str(ev.openedAt),
        closedAt: str(ev.ts) ?? str(ev.at) ?? str(ev.closedAt),
        exitReason: str(ev.reason) ?? str(ev.exitReason),
      });
    }
  }
  return out;
}

export type PaperPositionRow = {
  source: string;
  network: string;
  token: string;
  status: string;
  entry_price: number | null;
  current_price: number | null;
  exit_price: number | null;
  size_usd: number | null;
  realized_usd: number | null;
  unrealized_usd: number | null;
  pnl_usd: number | null;
  pnl_pct: number | null;
  exit_reason: string | null;
  opened_at: string | Date | null;
  closed_at: string | Date | null;
  updated_at?: string | Date | null;
};

function iso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function paperFromPositions(rows: PaperPositionRow[], publishedAt?: string | null): PaperDesk | null {
  if (!rows.length) return null;
  const trades: PaperTrade[] = rows.map((r) => ({
    source: r.source || 'paper_positions',
    network: r.network,
    token: r.token,
    status: r.status === 'closed' ? 'closed' : 'open',
    pnlUsd: r.pnl_usd,
    pnlPct: r.pnl_pct,
    sizeUsd: r.size_usd,
    openedAt: iso(r.opened_at),
    closedAt: iso(r.closed_at),
    exitReason: r.exit_reason,
  }));
  const open = rows.filter((r) => r.status !== 'closed');
  const closed = rows.filter((r) => r.status === 'closed');
  const realized = closed.reduce((a, r) => a + (r.realized_usd ?? r.pnl_usd ?? 0), 0);
  const unrealized = open.reduce((a, r) => a + (r.unrealized_usd ?? r.pnl_usd ?? 0), 0);
  const openCost = open.reduce((a, r) => a + (r.size_usd ?? 0), 0);
  const equityUsd = PAPER_STARTING_CAPITAL_USD + realized + unrealized;
  const cashUsd = PAPER_STARTING_CAPITAL_USD + realized - openCost;
  return finalizePaperDesk({
    source: 'paper_positions',
    publishedAt: publishedAt ?? null,
    cashUsd,
    equityUsd,
    realizedPnlUsd: realized,
    unrealizedPnlUsd: unrealized,
    openCount: open.length,
    closedCount: closed.length,
    trades,
  });
}

/** Defensive parse of paper_sim.paper_snapshot.summary JSON. */
export function paperFromSnapshot(summary: unknown, publishedAt?: string | null): PaperDesk | null {
  if (!summary || typeof summary !== 'object') return null;
  const s = summary as Record<string, unknown>;
  const tradesRaw = Array.isArray(s.trades) ? s.trades : Array.isArray(s.positions) ? s.positions : [];
  const trades: PaperTrade[] = tradesRaw
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
    .map((t) => ({
      source: str(t.source) ?? 'paper_snapshot',
      network: str(t.network) ?? str(t.chain) ?? 'unknown',
      token: str(t.token) ?? str(t.symbol) ?? 'unknown',
      status: str(t.status) === 'closed' ? 'closed' : 'open',
      pnlUsd: num(t.pnlUsd) ?? num(t.pnl_usd),
      pnlPct: num(t.pnlPct) ?? num(t.pnl_pct),
      sizeUsd: num(t.sizeUsd) ?? num(t.size_usd),
      openedAt: str(t.openedAt) ?? str(t.opened_at),
      closedAt: str(t.closedAt) ?? str(t.closed_at),
      exitReason: str(t.exitReason) ?? str(t.exit_reason),
    }));
  const equityUsd = num(s.equityUsd) ?? num(s.equity) ?? num(s.equity_usd);
  const cashUsd = num(s.cashUsd) ?? num(s.cash) ?? num(s.cash_usd);
  const realizedPnlUsd = num(s.realizedPnlUsd) ?? num(s.realized_usd) ?? num(s.realizedPnl);
  const unrealizedPnlUsd = num(s.unrealizedPnlUsd) ?? num(s.unrealized_usd);
  const openCount = num(s.openCount) ?? num(s.open) ?? trades.filter((t) => t.status === 'open').length;
  const closedCount = num(s.closedCount) ?? num(s.closed) ?? trades.filter((t) => t.status === 'closed').length;
  const hasAny = equityUsd != null || cashUsd != null || trades.length > 0 || (openCount ?? 0) > 0 || (closedCount ?? 0) > 0;
  if (!hasAny) return null;
  return finalizePaperDesk({
    source: 'paper_snapshot',
    publishedAt: publishedAt ?? null,
    cashUsd,
    equityUsd: equityUsd ?? (cashUsd != null ? cashUsd + (unrealizedPnlUsd ?? 0) : null),
    realizedPnlUsd,
    unrealizedPnlUsd,
    openCount: openCount ?? 0,
    closedCount: closedCount ?? 0,
    trades,
  });
}

export function choosePaperDesk(options: {
  snapshot?: PaperDesk | null;
  positions?: PaperDesk | null;
  synced?: PaperDesk | null;
}): PaperDesk {
  if (options.snapshot && !options.snapshot.empty) return options.snapshot;
  if (options.positions && !options.positions.empty) return options.positions;
  if (options.synced && !options.synced.empty) return options.synced;
  return options.snapshot ?? options.positions ?? options.synced ?? emptyPaperDesk();
}

export function imageSrc(path: string): string {
  return `/api/owner/desk/image?path=${encodeURIComponent(path)}`;
}

export function docName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}
