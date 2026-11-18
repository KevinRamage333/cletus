import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  OWNERS_DESK_TITLE,
  PAPER_STARTING_CAPITAL_USD,
  PAPER_EMPTY_MESSAGE,
  choosePaperDesk,
  emptyPaperDesk,
  emptyOwnersDesk,
  filterDocsByContent,
  isSafeBoxPath,
  paperFromEvmState,
  paperFromPositions,
  paperFromSnapshot,
  paperTradesFromJsonl,
  searchDocs,
  finalizePaperDesk,
  docName,
  imageSrc,
} from '@/lib/owners-desk';

const evmState = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/owners-desk-paper.json'), 'utf8'));
const evmTrades = readFileSync(resolve(__dirname, 'fixtures/evm-paper-trades.jsonl'), 'utf8');

describe("The Owner's Desk helpers", () => {
  it('names the desk exactly', () => {
    expect(OWNERS_DESK_TITLE).toBe("The Owner's Desk");
    expect(emptyOwnersDesk().title).toBe("The Owner's Desk");
    expect(PAPER_STARTING_CAPITAL_USD).toBe(150);
  });

  it('rejects unsafe box paths', () => {
    expect(isSafeBoxPath('/workspace/plans/redesign-progress.md')).toBe(true);
    expect(isSafeBoxPath('/etc/passwd')).toBe(false);
    expect(isSafeBoxPath('/workspace/../etc/passwd')).toBe(false);
    expect(isSafeBoxPath('/workspace/kr-cletus/docs/../.secrets/x')).toBe(false);
    expect(isSafeBoxPath('')).toBe(false);
    expect(isSafeBoxPath(null)).toBe(false);
  });

  it('computes paper equity vs a $150 start from real-shaped evm state and trades', () => {
    const desk = paperFromEvmState(evmState, evmTrades, '2026-11-17T16:30:00.000Z');
    expect(desk).not.toBeNull();
    // cash 90.5 + open value 20 * 1.1 = 112.5
    expect(desk!.equityUsd).toBeCloseTo(112.5, 6);
    expect(desk!.pnlVsStartUsd).toBeCloseTo(112.5 - 150, 6);
    expect(desk!.startingCapitalUsd).toBe(150);
    expect(desk!.openCount).toBe(1);
    expect(desk!.closedCount).toBe(2);
    expect(desk!.winCount).toBe(1);
    expect(desk!.winRatePct).toBeCloseTo(50, 6);
    expect(desk!.empty).toBe(false);
    expect(desk!.trades.some((t) => t.token === 'STAR' && t.status === 'open')).toBe(true);
    expect(desk!.trades.some((t) => t.token === 'Jacket' && t.pnlUsd === 15.2)).toBe(true);
  });

  it('handles an empty $150 book cleanly', () => {
    const empty = emptyPaperDesk();
    expect(empty.empty).toBe(true);
    expect(empty.equityUsd).toBe(150);
    expect(empty.pnlVsStartUsd).toBe(0);
    expect(empty.winRatePct).toBeNull();
    expect(empty.emptyMessage).toBe(PAPER_EMPTY_MESSAGE);
    expect(choosePaperDesk({})).toEqual(empty);
  });

  it('prefers a paper_snapshot over positions and synced files', () => {
    const snapshot = paperFromSnapshot({
      equityUsd: 162,
      cashUsd: 140,
      openCount: 1,
      closedCount: 1,
      realizedPnlUsd: 12,
      trades: [{ token: 'ABC', network: 'solana', status: 'closed', pnlUsd: 12, pnlPct: 8 }],
    }, '2026-11-17T17:00:00.000Z');
    const positions = paperFromPositions([{
      source: 'pos', network: 'base', token: 'ZZ', status: 'open',
      entry_price: 1, current_price: 1, exit_price: null, size_usd: 10,
      realized_usd: 0, unrealized_usd: 0, pnl_usd: 0, pnl_pct: 0,
      exit_reason: null, opened_at: '2026-11-17T16:00:00.000Z', closed_at: null,
    }]);
    const chosen = choosePaperDesk({ snapshot, positions, synced: paperFromEvmState(evmState, evmTrades) });
    expect(chosen.source).toBe('paper_snapshot');
    expect(chosen.equityUsd).toBe(162);
    expect(chosen.pnlVsStartUsd).toBe(12);
    expect(chosen.winRatePct).toBe(100);
  });

  it('builds a desk from paper_positions against the $150 start', () => {
    const desk = paperFromPositions([
      {
        source: 'paper_positions', network: 'ethereum', token: 'WIN', status: 'closed',
        entry_price: 1, current_price: 1.2, exit_price: 1.2, size_usd: 25,
        realized_usd: 5, unrealized_usd: 0, pnl_usd: 5, pnl_pct: 20,
        exit_reason: 'tp', opened_at: '2026-11-17T16:00:00.000Z', closed_at: '2026-11-17T16:10:00.000Z',
      },
      {
        source: 'paper_positions', network: 'base', token: 'OPEN', status: 'open',
        entry_price: 2, current_price: 2.2, exit_price: null, size_usd: 30,
        realized_usd: 0, unrealized_usd: 3, pnl_usd: 3, pnl_pct: 10,
        exit_reason: null, opened_at: '2026-11-17T16:15:00.000Z', closed_at: null,
      },
    ]);
    expect(desk).not.toBeNull();
    expect(desk!.equityUsd).toBeCloseTo(150 + 5 + 3, 6);
    expect(desk!.cashUsd).toBeCloseTo(150 + 5 - 30, 6);
    expect(desk!.openCount).toBe(1);
    expect(desk!.closedCount).toBe(1);
    expect(desk!.winRatePct).toBe(100);
  });

  it('treats an empty snapshot as empty, not as mock data', () => {
    expect(paperFromSnapshot({})).toBeNull();
    expect(paperFromSnapshot(null)).toBeNull();
    expect(paperFromPositions([])).toBeNull();
    expect(paperFromEvmState({}, '')).toBeNull();
  });

  it('parses trade journal entry/exit events', () => {
    const trades = paperTradesFromJsonl(
      '{"event":"entry","symbol":"DacityCoin","book":"solana","sizeUsd":15,"at":"2026-11-17T16:05:40.115Z"}\n{"event":"exit","symbol":"DacityCoin","book":"solana","pnlUsd":1.5,"pnlPct":10,"at":"2026-11-17T16:40:00Z","exitReason":"time"}\n',
      'trade-journal',
    );
    expect(trades).toHaveLength(2);
    expect(trades[0].status).toBe('open');
    expect(trades[1].status).toBe('closed');
    expect(trades[1].pnlUsd).toBe(1.5);
  });

  it('searches synced docs by path, workstream, and loaded content', () => {
    const docs = [
      { path: '/workspace/kr-cletus/docs/SECURITY_AUDIT.md', workstream: 'docs', sizeBytes: 10, sha256: null, modifiedAt: null, syncedAt: null },
      { path: '/workspace/plans/redesign-progress.md', workstream: 'plans', sizeBytes: 10, sha256: null, modifiedAt: null, syncedAt: null },
    ];
    expect(searchDocs(docs, 'security').map((d) => docName(d.path))).toEqual(['SECURITY_AUDIT.md']);
    expect(searchDocs(docs, 'plans')).toHaveLength(1);
    expect(filterDocsByContent(docs, { [docs[1].path]: 'live charts and gold ecosystem' }, 'gold').map((d) => docName(d.path))).toEqual(['redesign-progress.md']);
    expect(searchDocs(docs, '  ')).toEqual(docs);
  });

  it('builds a private image src and reports win rate for all-loss closed books', () => {
    expect(imageSrc('/workspace/kr-cletus/screenshots/redesign/desktop-home.png')).toContain('path=%2Fworkspace%2F');
    const desk = finalizePaperDesk({
      source: 'paper_positions',
      publishedAt: null,
      cashUsd: 140,
      equityUsd: 140,
      realizedPnlUsd: -10,
      unrealizedPnlUsd: 0,
      openCount: 0,
      closedCount: 1,
      trades: [{ source: 'x', network: 'base', token: 'LOSE', status: 'closed', pnlUsd: -10, pnlPct: -20, sizeUsd: 20, openedAt: null, closedAt: null, exitReason: 'stop' }],
    });
    expect(desk.winRatePct).toBe(0);
    expect(desk.pnlVsStartUsd).toBe(-10);
    expect(desk.empty).toBe(false);
  });
});
