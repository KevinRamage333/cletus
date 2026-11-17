import { expect, it } from 'vitest';
import { summarizePaperCloses } from '@/lib/public-paper-performance';

it('builds a chronological realized ledger and measures drawdown from its running peak', () => {
  const close = (minute: number, pnlUsd: number | null) => ({
    closedAt: new Date(Date.UTC(2026, 10, 17, 0, minute)), network: 'solana', symbol: 'SOL', pnlUsd, feesUsd: 1,
  });
  const report = summarizePaperCloses([close(5, null), close(4, 6), close(3, -15), close(2, 10), close(1, -4), close(0, 100)], 5);
  expect(report.ledger.map((row) => row.cumulativePnlUsd)).toEqual([-4, 6, -9, -3]);
  expect(report).toMatchObject({ truncated: true, omitted: 1, cumulativePnlUsd: -3, maxDrawdownUsd: 15, feesUsd: 4, wins: 2, losses: 2, flat: 0, winRate: 0.5 });
  expect(summarizePaperCloses([]).winRate).toBeNull();
});
