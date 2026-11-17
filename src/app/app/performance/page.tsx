'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ScreenStatus } from '@/components/ScreenStatus';
import { moneyText, refreshedLabel, screenState } from '@/lib/figure';

type Performance = {
  generatedAt: string;
  account: { startingBalance: number; cashUsd: number; equityUsd: number; realizedPnlUsd: number; unrealizedPnlUsd: number };
  coverage: { closedTradesAvailable: number; analyzedTrades: number; truncated: boolean; recentTradesReturned: number };
  scorecard: { trades: number; wins: number; losses: number; winRate: number | null; avgWinUsd: number | null; avgLossUsd: number | null; profitFactor: number | null; netPnlUsd: number; maxDrawdownUsd: number; maxDrawdownPct: number; sharpeAnnualised: number | null };
  last24h: { trades: number; pnlUsd: number; feesUsd: number };
  strategyAttribution: { signal: string; trades: number; wins: number; pnlUsd: number; feesUsd: number; winRate: number }[];
  equityCurve: { at: string; equity: number; pnlUsd: number }[];
  openPositions: { id: string; symbol: string; network: string; entryPrice: number; markPrice: number; sizeUsd: number; feesUsd: number; unrealizedPnlUsd: number; unrealizedPnlPct: number; openedAt: string }[];
  recentTrades: { id: string; symbol: string; network: string; entryPrice: number; exitPrice: number | null; sizeUsd: number; feesUsd: number; pnlUsd: number; pnlPct: number; closedAt: string | null; exitReason: string | null }[];
};

const usd = (n: number | null | undefined) => moneyText(n ?? null).text;
const pct = (n: number) => `${n.toFixed(2)}%`;
const sign = (n: number) => n >= 0 ? 'text-emerald-400' : 'text-red-400';

function Metric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-xl border border-white/10 bg-[#121212] p-4"><div className="text-[10px] uppercase tracking-wider text-white/45">{label}</div><div className={`mt-2 text-xl font-semibold font-mono ${tone}`}>{value}</div></div>;
}

export default function PerformancePage() {
  const [data, setData] = useState<Performance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/protected/performance', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error('Unable to load performance data');
      setData(await res.json());
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Performance data unavailable'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [load]);

  return <main className="min-h-screen bg-black text-white px-4 py-6 sm:px-6">
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div><Link href="/app/trade" className="text-xs text-amber-400 hover:underline">← Paper trading</Link><h1 className="mt-2 text-2xl font-bold">Performance & trade ledger</h1><p className="mt-1 text-sm text-white/45">Measured results from recorded fills, after recorded fees.</p></div>
        <span className="rounded-full border border-amber-400/30 px-3 py-1 text-[10px] uppercase tracking-wider text-amber-300">Paper book</span>
      </header>
      <ScreenStatus
        state={screenState({
          loading,
          error,
          hasData: Boolean(data),
          empty: Boolean(data) && data!.openPositions.length === 0 && data!.recentTrades.length === 0 && data!.scorecard.trades === 0,
          refreshedAt: data?.generatedAt,
          staleMs: 60_000,
        })}
        error={error}
        emptyLabel="No paper trades in the portfolio yet."
        refreshedLabel={refreshedLabel('Portfolio P&L', data?.generatedAt ?? null)}
      />
      {data && <>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Paper equity" value={usd(data.account.equityUsd)} />
          <Metric label={data.coverage.truncated ? "Net realized P&L in window" : "Net realized P&L"} value={usd(data.scorecard.netPnlUsd)} tone={sign(data.scorecard.netPnlUsd)} />
          <Metric label="Unrealized P&L" value={usd(data.account.unrealizedPnlUsd)} tone={sign(data.account.unrealizedPnlUsd)} />
          <Metric label="Win rate" value={data.scorecard.winRate === null ? 'Not enough trades' : pct(data.scorecard.winRate * 100)} />
          <Metric label="Closed trades analyzed" value={data.scorecard.trades.toLocaleString()} />
          <Metric label="Profit factor" value={data.scorecard.profitFactor === null ? '—' : data.scorecard.profitFactor.toFixed(2)} />
          <Metric label="Maximum drawdown" value={`${usd(data.scorecard.maxDrawdownUsd)} · ${pct(data.scorecard.maxDrawdownPct)}`} tone="text-amber-300" />
          <Metric label="Annualized Sharpe" value={data.scorecard.sharpeAnnualised === null ? 'Insufficient history' : data.scorecard.sharpeAnnualised.toFixed(2)} />
        </section>
        <section className="grid gap-3 sm:grid-cols-3">
          <Metric label="Last 24h trades" value={data.last24h.trades.toLocaleString()} />
          <Metric label="Last 24h realized P&L" value={usd(data.last24h.pnlUsd)} tone={sign(data.last24h.pnlUsd)} />
          <Metric label="Last 24h recorded fees" value={usd(data.last24h.feesUsd)} />
        </section>
        <section className="rounded-2xl border border-white/10 bg-[#121212] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Equity progression</h2><span className="text-[10px] text-white/40">Reconstructed from closed trade P&L</span></div>
          {data.equityCurve.length < 2 ? <p className="text-sm text-white/45">Not enough closed trades to plot an equity curve.</p> : <div className="flex h-36 items-end gap-1 border-b border-white/10 px-1">{data.equityCurve.map((point, i) => { const min = Math.min(...data.equityCurve.map(p => p.equity)); const max = Math.max(...data.equityCurve.map(p => p.equity)); const height = max === min ? 8 : Math.max(5, ((point.equity - min) / (max - min)) * 100); return <div key={point.at + i} title={`${new Date(point.at).toLocaleString()} · ${usd(point.equity)}`} className="flex-1 rounded-t bg-amber-400/70" style={{ height: `${height}%` }} />; })}</div>}
          <div className="text-xs text-white/40">Starting paper balance: {usd(data.account.startingBalance)} · Cash available: {usd(data.account.cashUsd)}</div>
          {data.coverage.truncated && <p className="text-xs text-amber-300">Showing analysis of the latest {data.coverage.analyzedTrades.toLocaleString()} of {data.coverage.closedTradesAvailable.toLocaleString()} closed trades. Older records are preserved but not included in these metrics.</p>}
        </section>
        <section className="rounded-2xl border border-white/10 bg-[#121212] p-4 space-y-3">
          <h2 className="font-semibold">Signal attribution</h2>
          <p className="text-xs text-white/40">Shows signal tags recorded at entry. Trades can contribute to more than one signal; this is attribution, not causal proof.</p>
          {data.strategyAttribution.length ? <div className="space-y-2">{data.strategyAttribution.map(s => <div key={s.signal} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-white/5 py-2 text-sm"><div className="min-w-0"><div className="font-medium">{s.signal}</div><div className="text-[10px] text-white/40">{s.trades} trades · {pct(s.winRate * 100)} wins</div></div><div className="text-xs text-white/40">Fees {usd(s.feesUsd)}</div><div className={`font-mono ${sign(s.pnlUsd)}`}>{usd(s.pnlUsd)}</div></div>)}</div> : <p className="text-sm text-white/45">No recorded signal tags yet.</p>}
        </section>
        <section className="rounded-2xl border border-white/10 bg-[#121212] p-4 space-y-3">
          <h2 className="font-semibold">Open paper positions</h2>
          {data.openPositions.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-white/40"><tr><th className="py-2">Asset</th><th>Entry / mark</th><th>Size</th><th>Fees</th><th>Unrealized</th></tr></thead><tbody>{data.openPositions.map(p => <tr key={p.id} className="border-t border-white/5"><td className="py-2">{p.symbol}<div className="text-[10px] text-white/35">{p.network}</div></td><td>{p.entryPrice} / {p.markPrice}</td><td>{usd(p.sizeUsd)}</td><td>{usd(p.feesUsd)}</td><td className={sign(p.unrealizedPnlUsd)}>{usd(p.unrealizedPnlUsd)} ({pct(p.unrealizedPnlPct)})</td></tr>)}</tbody></table></div> : <p className="text-sm text-white/45">No open paper positions.</p>}
        </section>
        <section className="rounded-2xl border border-white/10 bg-[#121212] p-4 space-y-3">
          <h2 className="font-semibold">Recent closed trades</h2>
          {data.recentTrades.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-white/40"><tr><th className="py-2">Asset</th><th>Entry → exit</th><th>Fees</th><th>Net P&L</th><th>Exit reason</th><th>Closed</th></tr></thead><tbody>{data.recentTrades.map(t => <tr key={t.id} className="border-t border-white/5"><td className="py-2">{t.symbol}<div className="text-[10px] text-white/35">{t.network}</div></td><td>{t.entryPrice} → {t.exitPrice ?? '—'}</td><td>{usd(t.feesUsd)}</td><td className={sign(t.pnlUsd)}>{usd(t.pnlUsd)} ({pct(t.pnlPct)})</td><td>{t.exitReason ?? '—'}</td><td>{t.closedAt ? new Date(t.closedAt).toLocaleString() : '—'}</td></tr>)}</tbody></table></div> : <p className="text-sm text-white/45">No closed paper trades yet. The ledger will populate when the engine records exits.</p>}
        </section>
        <p className="text-[10px] text-white/30">Updated {new Date(data.generatedAt).toLocaleTimeString()} · Auto-refreshes every 15 seconds · No simulated fills are represented as on-chain transactions.</p>
      </>}
    </div>
  </main>;
}
