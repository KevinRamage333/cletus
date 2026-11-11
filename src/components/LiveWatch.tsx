'use client';
/**
 * Shared live trade-watching view: hero open-trade chart with entry/SL/TP,
 * current P&L, total and today's gains, anonymizable trade feed with Solscan
 * links, and an equity curve. Used by the owner dashboard, signed-in users,
 * and (with explicit simulated data) the public demo preview.
 */
import type { ReactNode } from 'react';
import TokenChart from './TokenChart';
import EquityCurve from './EquityCurve';
import type { LiveWatchModel } from '@/lib/live-watch';

const usd = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const cls = (n: number | null | undefined) => (n === null || n === undefined ? 'text-white/70' : n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-white/70');
const ago = (d: string | null | undefined) => {
  if (!d) return '';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (!Number.isFinite(s)) return '';
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

export type LiveWatchActions = {
  sellAllLabel?: string;
  resumeLabel?: string;
  pauseLabel?: string;
  onSellAll?: () => void;
  onResume?: () => void;
  onPause?: () => void;
  busy?: boolean;
};

export default function LiveWatch({ watch, actions, footer }: { watch: LiveWatchModel; actions?: LiveWatchActions; footer?: ReactNode }) {
  const open = watch.open;
  const emptyBook = !open && watch.closedTrades === 0;
  const pnl = open ? open.pnlUsd : (emptyBook ? null : watch.totalPnl);
  const pnlPct = open ? open.pnlPct : null;
  return (
    <div className="space-y-5" data-testid="live-watch" data-scope={watch.scope}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold gold-text m-0">{watch.label}</h2>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${watch.mode === 'live' && !watch.simulatedBadge ? 'border-red-500/60 text-red-300' : 'border-amber-500/50 text-amber-300'}`}>
          {watch.mode === 'live' && !watch.simulatedBadge ? 'LIVE' : 'SIMULATION'}
        </span>
        {watch.halted && <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-500/60 text-red-300">HALTED</span>}
        {watch.paused && !watch.halted && <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-200">PAUSED</span>}
        {watch.sol != null && <span className="text-xs text-white/45 font-mono ml-auto">{watch.sol.toFixed(4)} SOL{watch.solPriceUsd ? ` · ${usd(watch.solPriceUsd, 2)}` : ''}</span>}
      </div>

      <section className="rounded-2xl border border-amber-500/30 bg-[#0b0a07] p-4 sm:p-5" data-testid="live-watch-hero">
        {open ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-amber-300/80">Open · {open.symbol}</div>
                <div className={`text-4xl sm:text-5xl font-extrabold font-mono leading-tight ${cls(pnl)}`}>{usd(pnl)}</div>
                <div className={`text-xl font-mono ${cls(pnlPct)}`}>{pct(pnlPct)}</div>
              </div>
              <div className="text-xs text-white/55 space-y-0.5 font-mono text-right">
                <div>Size {usd(open.sizeUsd)}</div>
                <div>Entry {open.entryPrice.toPrecision(4)}</div>
                <div>Last {open.lastPrice.toPrecision(4)}</div>
                {open.stopLoss != null && <div className="text-red-300">SL {open.stopLoss.toPrecision(4)}</div>}
                {open.takeProfit != null && <div className="text-emerald-300">TP {open.takeProfit.toPrecision(4)}</div>}
                <div className="text-white/35">{ago(open.openedAt)}</div>
                {open.solscanEntry && <a className="text-amber-300" href={open.solscanEntry} target="_blank" rel="noreferrer">entry on Solscan</a>}
              </div>
            </div>
            <div className="mt-4">
              <TokenChart
                address={open.mint}
                pool={open.pairAddress}
                height={280}
                compact
                apiBase={watch.chartApiBase}
                levels={{ entry: open.entryPrice, stopLoss: open.stopLoss, takeProfit: open.takeProfit }}
              />
            </div>
          </>
        ) : (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-white/45">No open trade</div>
            <div className={`text-4xl sm:text-5xl font-extrabold font-mono leading-tight ${cls(pnl)}`}>{usd(pnl)}</div>
            <div className="text-sm text-white/50 mt-1" data-testid="live-watch-empty">
              {watch.emptyMessage ?? (emptyBook ? 'No recorded trades yet.' : 'Total recorded P&L · waiting for the next entry')}
            </div>
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Equity', usd(watch.equityUsd), watch.sol != null ? `${watch.sol.toFixed(3)} SOL` : ''],
          ['Total gains', emptyBook ? '—' : usd(watch.totalPnl), emptyBook ? 'no live closes yet' : `realized ${usd(watch.realizedPnl)}`],
          ["Today's P&L", emptyBook ? '—' : usd(watch.todayPnl), 'America/Chicago day'],
          ['Win rate', watch.winRate == null ? '—' : `${(watch.winRate * 100).toFixed(0)}%`, `${watch.wins}W / ${watch.losses}L · ${watch.closedTrades} closed`],
        ].map(([l, v, s], i) => (
          <div key={l} className="rounded-2xl border border-white/10 bg-[#121212] p-4">
            <div className="text-[11px] text-white/40 uppercase tracking-wider">{l}</div>
            <div className={`text-xl font-bold font-mono mt-1 ${i === 1 || i === 2 ? cls(i === 1 ? watch.totalPnl : watch.todayPnl) : 'text-white'}`}>{v}</div>
            <div className="text-xs text-white/40 mt-0.5">{s}</div>
          </div>
        ))}
      </section>

      {actions && (actions.onSellAll || actions.onResume || actions.onPause) && (
        <div className="flex flex-wrap gap-2">
          {watch.halted || (watch.paused && !actions.onPause)
            ? (actions.onResume && <button type="button" className="btn primary" disabled={actions.busy} onClick={actions.onResume}>{actions.resumeLabel ?? 'Resume'}</button>)
            : (actions.onSellAll && <button type="button" className="btn danger" disabled={actions.busy} onClick={actions.onSellAll} data-testid="sell-all">{actions.sellAllLabel ?? 'Sell all'}</button>)}
          {actions.onPause && !watch.halted && !watch.paused && <button type="button" className="btn small" disabled={actions.busy} onClick={actions.onPause}>{actions.pauseLabel ?? 'Pause new trades'}</button>}
        </div>
      )}

      <section className="rounded-2xl border border-white/10 bg-[#121212] p-4">
        <h3 className="text-sm font-semibold mb-2">Equity curve</h3>
        <EquityCurve points={watch.equityCurve} />
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#121212] p-4">
        <h3 className="text-sm font-semibold mb-3">Trade feed</h3>
        {watch.feed.length === 0 ? (
          <p className="text-sm text-white/40">{watch.emptyMessage ?? 'No recorded trades yet.'}</p>
        ) : (
          <ul className="divide-y divide-white/10" data-testid="trade-feed">
            {watch.feed.map((t) => (
              <li key={t.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-[10px] uppercase tracking-wider text-white/40 w-14">{t.kind}</span>
                <span className="font-semibold">{t.symbol}</span>
                {t.kind === 'sell' && t.win !== null && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${t.win ? 'border-emerald-500/40 text-emerald-400' : 'border-red-500/40 text-red-400'}`}>{t.win ? 'WIN' : 'LOSS'}</span>
                )}
                {t.simulated && <span className="text-[10px] text-amber-300/80">sim</span>}
                <span className={`font-mono ml-auto ${cls(t.pnlUsd)}`}>{t.pnlUsd == null && t.pnlPct == null ? usd(t.sizeUsd) : `${usd(t.pnlUsd)} ${pct(t.pnlPct)}`}</span>
                <span className="text-[11px] text-white/35 w-full sm:w-auto sm:ml-0">{ago(t.at)}{t.reason ? ` · ${t.reason}` : ''}</span>
                {t.solscan && <a href={t.solscan} className="text-amber-300 text-[11px]" target="_blank" rel="noreferrer">Solscan</a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {footer}
    </div>
  );
}
