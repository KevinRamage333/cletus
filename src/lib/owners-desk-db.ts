/**
 * Read-only Neon queries for The Owner's Desk. Never logs connection URLs.
 */
import { prisma } from '@/lib/db';
import { isDemo } from '@/lib/demo';
import {
  emptyOwnersDesk,
  imageSrc,
  isSafeBoxPath,
  paperFromEvmState,
  paperFromPositions,
  paperFromSnapshot,
  paperTradesFromJsonl,
  choosePaperDesk,
  finalizePaperDesk,
  PAPER_STARTING_CAPITAL_USD,
  type BuildProgressRow,
  type OwnersDeskPayload,
  type PaperPositionRow,
  type SyncedDoc,
  type SyncedImage,
} from '@/lib/owners-desk';

function canUseDb(env: Record<string, string | undefined> = process.env): boolean {
  const url = env.DATABASE_URL ?? '';
  return Boolean(url) && !url.startsWith('file:');
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function safeError(): Error {
  return new Error('owners-desk query failed');
}

export async function loadOwnersDesk(): Promise<OwnersDeskPayload> {
  if (isDemo() || !canUseDb()) return emptyOwnersDesk();
  try {
    const [progressRows, docRows, imageRows, snapshotRows, positionRows, evmStateRows, evmTradeRows, journalRows] =
      await Promise.all([
        prisma.$queryRaw<Array<{ id: number; saved_at: Date; workstream: string; git_ref: string | null; summary: string }>>`
          SELECT id, saved_at, workstream, git_ref, summary
          FROM public.cletus_build_progress
          ORDER BY saved_at DESC
          LIMIT 8`,
        prisma.$queryRaw<Array<{
          path: string; workstream: string | null; size_bytes: number | null; sha256: string | null;
          modified_at: Date | null; synced_at: Date | null;
        }>>`
          SELECT path, workstream, size_bytes, sha256, modified_at, synced_at
          FROM public.box_files
          ORDER BY synced_at DESC NULLS LAST, path`,
        prisma.$queryRaw<Array<{
          path: string; workstream: string | null; content_type: string | null; size_bytes: number | null;
          sha256: string | null; has_image: boolean; modified_at: Date | null; synced_at: Date | null;
        }>>`
          SELECT path, workstream, content_type, size_bytes, sha256,
                 (content_base64 IS NOT NULL) AS has_image, modified_at, synced_at
          FROM public.box_images
          ORDER BY path`,
        prisma.$queryRaw<Array<{ published_at: Date; summary: unknown }>>`
          SELECT published_at, summary FROM paper_sim.paper_snapshot WHERE id = 1 LIMIT 1`,
        prisma.$queryRaw<PaperPositionRow[]>`
          SELECT source, network, token, status, entry_price, current_price, exit_price, size_usd,
                 realized_usd, unrealized_usd, pnl_usd, pnl_pct, exit_reason, opened_at, closed_at, updated_at
          FROM paper_sim.paper_positions
          ORDER BY opened_at DESC NULLS LAST
          LIMIT 200`,
        prisma.$queryRaw<Array<{ content: string | null; synced_at: Date | null }>>`
          SELECT content, synced_at FROM public.box_files
          WHERE path = '/workspace/cletus-sim/logs/evm-paper-state.json' LIMIT 1`,
        prisma.$queryRaw<Array<{ content: string | null }>>`
          SELECT content FROM public.box_files
          WHERE path = '/workspace/cletus-sim/logs/evm-paper-trades.jsonl' LIMIT 1`,
        prisma.$queryRaw<Array<{ content: string | null }>>`
          SELECT content FROM public.box_files
          WHERE path = '/workspace/cletus-sim/logs/trade-journal.jsonl' LIMIT 1`,
      ]);

    const progress: BuildProgressRow[] = progressRows.map((r) => ({
      id: r.id,
      savedAt: iso(r.saved_at) ?? '',
      workstream: r.workstream,
      gitRef: r.git_ref,
      summary: r.summary,
    }));

    const docs: SyncedDoc[] = docRows
      .filter((r) => isSafeBoxPath(r.path))
      .map((r) => ({
        path: r.path,
        workstream: r.workstream,
        sizeBytes: r.size_bytes,
        sha256: r.sha256,
        modifiedAt: iso(r.modified_at),
        syncedAt: iso(r.synced_at),
      }));

    const images: SyncedImage[] = imageRows
      .filter((r) => isSafeBoxPath(r.path))
      .map((r) => ({
        path: r.path,
        workstream: r.workstream,
        contentType: r.content_type,
        sizeBytes: r.size_bytes,
        sha256: r.sha256,
        hasImage: Boolean(r.has_image),
        modifiedAt: iso(r.modified_at),
        syncedAt: iso(r.synced_at),
        src: imageSrc(r.path),
      }));

    let evmState: unknown = null;
    const evmSyncedAt = evmStateRows[0]?.synced_at ? iso(evmStateRows[0].synced_at) : null;
    if (evmStateRows[0]?.content) {
      try { evmState = JSON.parse(evmStateRows[0].content); } catch { evmState = null; }
    }
    const evmTrades = evmTradeRows[0]?.content ?? null;
    const journal = journalRows[0]?.content ?? null;

    const syncedFromEvm = paperFromEvmState(evmState, evmTrades, evmSyncedAt);
    let synced = syncedFromEvm;
    if (journal) {
      const journalTrades = paperTradesFromJsonl(journal, 'trade-journal');
      if (journalTrades.length) {
        if (synced) {
          const existing = new Set(synced.trades.map((t) => `${t.status}:${t.token}:${t.openedAt}:${t.closedAt}`));
          const extra = journalTrades.filter((t) => !existing.has(`${t.status}:${t.token}:${t.openedAt}:${t.closedAt}`));
          if (extra.length) {
            const openCount = synced.openCount + extra.filter((t) => t.status === 'open').length;
            const closedCount = synced.closedCount + extra.filter((t) => t.status === 'closed').length;
            synced = finalizePaperDesk({
              ...synced,
              openCount,
              closedCount,
              trades: [...synced.trades, ...extra],
            });
          }
        } else {
          const open = journalTrades.filter((t) => t.status === 'open');
          const closed = journalTrades.filter((t) => t.status === 'closed');
          const realized = closed.reduce((a, t) => a + (t.pnlUsd ?? 0), 0);
          synced = finalizePaperDesk({
            source: 'synced_files',
            publishedAt: null,
            cashUsd: null,
            equityUsd: PAPER_STARTING_CAPITAL_USD + realized,
            realizedPnlUsd: realized,
            unrealizedPnlUsd: null,
            openCount: open.length,
            closedCount: closed.length,
            trades: journalTrades,
          });
        }
      }
    }

    const snapshot = snapshotRows[0]
      ? paperFromSnapshot(snapshotRows[0].summary, iso(snapshotRows[0].published_at))
      : null;
    const positions = paperFromPositions(positionRows, snapshotRows[0] ? iso(snapshotRows[0].published_at) : null);
    const paper = choosePaperDesk({ snapshot, positions, synced });

    return {
      title: "The Owner's Desk",
      progress,
      latestProgress: progress[0] ?? null,
      paper,
      docs,
      images,
    };
  } catch (e) {
    // Do not include the original message; it can contain connection strings.
    console.error('[cletus] owners-desk', (e as Error)?.name ?? 'Error');
    void safeError;
    return emptyOwnersDesk();
  }
}

export async function loadOwnersDeskDoc(path: string): Promise<{ path: string; workstream: string | null; content: string; syncedAt: string | null } | null> {
  if (!isSafeBoxPath(path) || isDemo() || !canUseDb()) return null;
  try {
    const rows = await prisma.$queryRaw<Array<{ path: string; workstream: string | null; content: string | null; synced_at: Date | null }>>`
      SELECT path, workstream, content, synced_at FROM public.box_files WHERE path = ${path} LIMIT 1`;
    const row = rows[0];
    if (!row || row.content == null) return null;
    return { path: row.path, workstream: row.workstream, content: row.content, syncedAt: iso(row.synced_at) };
  } catch (e) {
    console.error('[cletus] owners-desk doc', (e as Error)?.name ?? 'Error');
    return null;
  }
}

export async function loadOwnersDeskImage(path: string): Promise<{ contentType: string; bytes: Buffer } | null> {
  if (!isSafeBoxPath(path) || isDemo() || !canUseDb()) return null;
  try {
    const rows = await prisma.$queryRaw<Array<{ content_type: string | null; content_base64: string | null }>>`
      SELECT content_type, content_base64 FROM public.box_images WHERE path = ${path} LIMIT 1`;
    const row = rows[0];
    if (!row?.content_base64) return null;
    const bytes = Buffer.from(row.content_base64, 'base64');
    return { contentType: row.content_type || 'application/octet-stream', bytes };
  } catch (e) {
    console.error('[cletus] owners-desk image', (e as Error)?.name ?? 'Error');
    return null;
  }
}
