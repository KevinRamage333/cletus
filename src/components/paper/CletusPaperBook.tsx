'use client';
import Link from 'next/link';
import { Refreshed, StateBox, Stat } from '@/components/app/ui';
import type { PaperRow } from '@/lib/paper-snapshot';
import { usePaperSnapshot } from './usePaperSnapshot';

const usd = (n: number | null | undefined, sign = false) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${s}` : sign && n > 0 ? `+${s}` : s;
};
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);
const tone = (n: number | null | undefined) => (n == null ? 'muted' : n >= 0 ? 'up' : 'down') as 'up' | 'down' | 'muted';
const price = (p: number | null) => (p == null ? '—' : p < 0.0001 ? p.toExponential(3) : p < 1 ? p.toFixed(6) : p.toFixed(4));
const NET: Record<string, string> = { solana: 'Solana', ethereum: 'Ethereum', base: 'Base', bsc: 'BNB', polygon: 'Polygon', cronos: 'Cronos', arbitrum: 'Arbitrum' };
const net = (n: string) => NET[n] ?? n;
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export function PaperLabel() {
  return <span className="inline-flex items-center gap-1.5 border border-sky-300/40 bg-sky-300/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.16em] text-sky-200" data-testid="paper-label">Paper trading · simulated</span>;
}

function Row({ r }: { r: PaperRow }) {
  const open = r.status === 'open';
  return (
    <li className="panel flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm" data-testid={open ? 'paper-open-row' : 'paper-closed-row'}>
      <div className="min-w-[8rem] flex-1">
        <p className="font-semibold text-[#f6f1e4]">{r.token} <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-[#8a8478]">{net(r.network)}</span></p>
        <p className="num text-xs text-[#8a8478]">{open ? `Opened ${time(r.openedAt)}` : `Closed ${time(r.closedAt)}${r.exitReason ? ` · ${r.exitReason}` : ''}`}</p>
      </div>
      <div className="num text-xs text-[#a39c8f]">entry {price(r.entryPrice)}<br />{open ? 'now' : 'exit'} {price(open ? r.currentPrice : r.exitPrice)}</div>
      <div className="num text-xs text-[#a39c8f]">size {usd(r.sizeUsd)}</div>
      <div className={`num w-24 text-right font-semibold ${r.pnlUsd == null ? 'text-[#8a8478]' : r.pnlUsd >= 0 ? 'text-green-300' : 'text-red-300'}`}>{usd(r.pnlUsd, true)}<br /><span className="text-xs">{pct(r.pnlPct)}</span></div>
      {r.chartUrl && <a href={r.chartUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#c9a24a] underline">Chart</a>}
    </li>
  );
}

/** Cletus's own paper book from the isolated paper workers (real market data, simulated fills). */
export default function CletusPaperBook({ variant = 'full' }: { variant?: 'full' | 'compact' | 'feed' }) {
  const { data, state } = usePaperSnapshot();
  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Cletus paper book</h3><PaperLabel /></div>
      {data?.available && <Refreshed at={data.publishedAt} stale={data.stale} label="Published" />}
    </div>
  );
  if (state === 'loading') return <section className="mt-6" data-testid="paper-book">{header}<div className="skeleton h-24" /></section>;
  if (state === 'error' || !data) return <section className="mt-6" data-testid="paper-book">{header}<StateBox kind="error" title="Paper book unavailable">Could not load Cletus&apos;s paper trades. Nothing is shown instead of guessing.</StateBox></section>;
  if (!data.available) return <section className="mt-6" data-testid="paper-book">{header}<StateBox kind="empty" title="No paper data published yet">{data.reason ?? 'The paper feed has not published.'} Figures stay “—” until real paper trades exist.</StateBox></section>;

  const showOpen = variant === 'compact' ? data.open.slice(0, 4) : data.open;
  const showClosed = variant === 'compact' ? data.recent.slice(0, 3) : variant === 'feed' ? data.recent.slice(0, 10) : data.recent;
  return (
    <section className="mt-6" data-testid="paper-book">
      {header}
      {data.stale && <div className="mb-3"><StateBox kind="stale" title="Paper feed is behind">The last snapshot is more than 5 minutes old. Numbers below are as of the time shown.</StateBox></div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="paper-stats">
        <Stat label="Paper equity" value={usd(data.equityUsd)} sub={`Started with ${usd(data.startingUsd)}`} testId="paper-equity" />
        <Stat label="Total P&L" value={usd(data.totalPnlUsd, true)} tone={tone(data.totalPnlUsd)} sub={`Realized ${usd(data.realizedUsd, true)} · open ${usd(data.unrealizedUsd, true)}`} />
        <Stat label="Open positions" value={data.openCount} sub={data.books.map((b) => `${b.label} ${b.open}`).join(' · ') || '—'} testId="paper-open-count" />
        <Stat label="Closed trades" value={data.closedCount ?? "—"} sub={data.winRatePct == null ? 'Win rate —' : `Win rate ${data.winRatePct.toFixed(1)}% (${data.wins ?? '—'}W/${data.losses ?? '—'}L)`} testId="paper-closed-count" />
      </div>
      {variant !== 'compact' && data.books.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="paper-books">
          {data.books.map((b) => <div key={b.book} className="panel p-3 text-xs text-[#a39c8f]"><p className="font-semibold text-[#f6f1e4]">{b.label}</p><p className="num mt-1">start {usd(b.startingUsd)} · cash {usd(b.cashUsd)} · equity {usd(b.equityUsd)} · {b.open} open / {b.closed} closed</p></div>)}
        </div>
      )}
      {variant === 'full' && data.networks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="paper-networks">
          {data.networks.map((n) => <span key={n.network} className="panel px-3 py-1.5 text-xs text-[#a39c8f]"><b className="text-[#f6f1e4]">{net(n.network)}</b> {n.open} open · {n.closed} closed · <span className={n.pnlUsd == null ? '' : n.pnlUsd >= 0 ? 'text-green-300' : 'text-red-300'}>{usd(n.pnlUsd, true)}</span></span>)}
        </div>
      )}
      {variant !== 'feed' && (
        <>
          <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-[.16em] text-[#8a8478]">Open paper positions</h4>
          {showOpen.length ? <ul className="space-y-2" data-testid="paper-open">{showOpen.map((r) => <Row key={r.id} r={r} />)}</ul> : <StateBox kind="empty" title="No open paper positions">Cletus is scanning; nothing currently passes his entry rules.</StateBox>}
        </>
      )}
      <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-[.16em] text-[#8a8478]">{variant === 'feed' ? 'Latest paper trades' : 'Recently closed'}</h4>
      {variant === 'feed' && data.open.length > 0 && <ul className="mb-2 space-y-2" data-testid="paper-open">{data.open.slice(0, 5).map((r) => <Row key={r.id} r={r} />)}</ul>}
      {showClosed.length ? <ul className="space-y-2" data-testid="paper-closed">{showClosed.map((r) => <Row key={r.id} r={r} />)}</ul> : <StateBox kind="empty" title="No closed paper trades yet">Closed trades appear here as soon as an exit fires.</StateBox>}
      {variant === 'compact' && <Link href="/app/portfolio#cletus-paper" className="btn-line mt-3 inline-flex !py-2">Full paper book →</Link>}
      <p className="mt-3 text-[11px] text-[#6f695f]">Simulated fills on real market prices (DexScreener / GeckoTerminal). No real funds are traded. Live trading is off.</p>
    </section>
  );
}
