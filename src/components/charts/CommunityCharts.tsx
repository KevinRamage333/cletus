'use client';
/** Community live charts: collective realized paper P&L over time, and a live price chart for the most-traded token. */
import { useMemo } from 'react';
import LiveTokenChart from '@/components/charts/LiveTokenChart';
import PnlChart from '@/components/charts/PnlChart';
import { useMovers } from '@/components/market/useMovers';
import type { PnlPoint } from '@/lib/live-chart';

export type CommunityChartData = { pnlSeries?: PnlPoint[]; mostTraded?: { mint: string; symbol: string; trades: number } | null; suppressed?: boolean; minContributors?: number } | null;

export default function CommunityCharts({ data, statusNote }: { data: CommunityChartData; statusNote: string | null }) {
  const { data: board } = useMovers(30_000);
  // When member data is not connected, chart the token with the most 1h volume on the live board and say so.
  const fallback = useMemo(() => [...(board?.tokens ?? [])].filter((t) => t.volume1hUsd != null).sort((a, b) => (b.volume1hUsd ?? 0) - (a.volume1hUsd ?? 0))[0] ?? null, [board]);
  const mt = data?.mostTraded ?? null;
  const pts = data?.pnlSeries ?? [];
  const last = pts.length ? pts[pts.length - 1].value : null;
  const emptyBody = statusNote ?? (data?.suppressed ? `The curve stays hidden until at least ${data.minContributors ?? 5} members have closed paper trades.` : 'No closed paper trades have been recorded yet.');
  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-2" data-testid="community-charts">
      <section className="panel p-4" data-testid="community-pnl">
        <div className="mb-3 flex items-end justify-between gap-2">
          <div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#e3c06a]">Collective P&amp;L over time</p><p className="text-xs text-[#8a8478]">Realized paper closes, cumulative, refreshed every minute</p></div>
          {last != null && <p className={`num text-lg font-bold ${last >= 0 ? 'text-green-400' : 'text-red-400'}`}>{last >= 0 ? '+' : '-'}${Math.abs(last).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>}
        </div>
        <PnlChart points={pts} height={300} testId="community-pnl-chart" empty={{ title: 'No P&L curve to show yet', body: emptyBody }} />
      </section>
      <LiveTokenChart
        key={mt?.mint ?? fallback?.mint ?? 'none'}
        address={mt?.mint ?? fallback?.mint ?? null}
        pool={mt ? null : fallback?.pair ?? null}
        title={mt ? `Most traded by the community · ${mt.trades} trades` : 'Most active on the live board (1h volume)'}
        note={mt ? undefined : 'Community trade counts are not connected here, so this shows the highest-volume live Solana token'}
        height={300}
        testId="community-token-chart"
      />
    </div>
  );
}
