'use client';
/** Feed live chart: pick any token from the trade feed or the live movers board and watch its real-time candles. */
import { useEffect, useMemo, useState } from 'react';
import LiveTokenChart from '@/components/charts/LiveTokenChart';
import { useMovers } from '@/components/market/useMovers';
import { formatPct, sortMovers } from '@/lib/movers';

type Pick = { key: string; label: string; address?: string; symbol?: string; pool?: string; source: 'feed' | 'mover'; change?: number | null };

export default function FeedChart() {
  const { data: board, state } = useMovers(20_000);
  const [feedSyms, setFeedSyms] = useState<string[]>([]);
  const [sel, setSel] = useState<Pick | null>(null);

  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const r = await fetch('/api/live', { cache: 'no-store' });
        const j = await r.json();
        const tick = [...(j?.ticker ?? []), ...(j?.simulation?.ticker ?? [])] as Array<{ token?: string }>;
        const syms = [...new Set(tick.map((t) => (t.token ?? '').trim()).filter((s) => /^[A-Za-z0-9$._-]{1,20}$/.test(s)))].slice(0, 8);
        if (on) setFeedSyms(syms);
      } catch { /* feed unavailable: movers still work */ }
    };
    void load();
    const t = window.setInterval(load, 30_000);
    return () => { on = false; window.clearInterval(t); };
  }, []);

  const picks = useMemo<Pick[]>(() => {
    const movers = sortMovers(board?.tokens ?? [], 'movers').slice(0, 10).map((t) => ({ key: t.mint, label: t.symbol, address: t.mint, pool: t.pair, source: 'mover' as const, change: t.change1hPct }));
    const fromFeed = feedSyms.map((s) => ({ key: `sym:${s}`, label: s, symbol: s, source: 'feed' as const }));
    return [...fromFeed, ...movers];
  }, [board, feedSyms]);

  useEffect(() => { if (!sel && picks.length) setSel(picks[0]); }, [picks, sel]);
  // Keep the chosen token even if it drops off the refreshed movers list.
  const cur = sel;
  const shown = sel && !picks.some((p) => p.key === sel.key) ? [sel, ...picks] : picks;

  return (
    <section className="space-y-3" data-testid="feed-chart">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><p className="eyebrow">Live chart</p><h3 className="text-lg font-bold text-[#f6f1e4]">Tap a token to chart it live</h3></div>
        <p className="text-[11px] text-[#8a8478]">◆ from the trade feed · others from the live Solana movers board</p>
      </div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="listbox" aria-label="Token to chart" data-testid="feed-chart-picks">
        {shown.map((p) => (
          <button key={p.key} type="button" role="option" aria-selected={sel?.key === p.key} onClick={() => setSel(p)} data-testid="feed-chart-pick" data-symbol={p.label}
            className={`num shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${sel?.key === p.key ? 'border-[#d4af37] bg-[#d4af37]/12 text-[#f3dc95]' : 'border-[rgba(212,175,55,.2)] text-[#a39c8f] hover:text-[#f2ede2]'}`}>
            {p.source === 'feed' ? '◆ ' : ''}{p.label}
            {p.change != null && <span className={`ml-1.5 ${p.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPct(p.change)}</span>}
          </button>
        ))}
        {!picks.length && state === 'loading' && <div className="skeleton h-8 w-full" />}
        {!picks.length && state !== 'loading' && <p className="text-xs text-red-300" role="alert">Live market board is unavailable right now, so there is nothing to chart. It retries automatically.</p>}
      </div>
      <LiveTokenChart key={cur?.key ?? 'none'} address={cur?.address} symbol={cur?.symbol} pool={cur?.pool} title={cur?.source === 'feed' ? 'From the trade feed' : 'Live mover'} testId="live-chart" />
    </section>
  );
}
