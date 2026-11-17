'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMovers } from '@/components/market/useMovers';
import { PageHeader, Refreshed, StateBox, TokenAvatar, useNow } from '@/components/app/ui';
import { MOVER_SORTS, formatAge, formatPct, formatPrice, formatUsdCompact, freshness, sortMovers, type MoverCard, type MoverSort } from '@/lib/movers';

function Change({ label, v }: { label: string; v: number | null }) {
  const cls = v == null ? 'text-[#8a8478] border-white/10' : v >= 0 ? 'text-emerald-300 border-emerald-400/30 bg-emerald-400/5' : 'text-red-300 border-red-400/30 bg-red-400/5';
  return <span className={`num inline-flex items-center gap-1 border px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}><span className="text-[9px] opacity-70">{label}</span>{formatPct(v)}</span>;
}

function Card({ t, now }: { t: MoverCard; now: number }) {
  return (
    <article className="panel group flex flex-col p-3 transition-colors hover:border-[rgba(212,175,55,.45)]" data-testid="token-card">
      <div className="flex gap-3">
        <TokenAvatar src={t.imageUrl} symbol={t.symbol} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="truncate font-bold text-[#f6f1e4]" title={t.name}>{t.name}</p><p className="truncate text-xs font-semibold text-[#c9a24a]">${t.symbol}</p></div>
            <span className="num shrink-0 text-[10px] text-[#8a8478]" title="Pool age">{formatAge(t.createdAt, now)}</span>
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-wider text-[#8a8478]">Market cap</p>
          <p className="num -mt-0.5 text-lg font-extrabold text-[#e3c06a]">{formatUsdCompact(t.marketCapUsd)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5"><Change label="5m" v={t.change5mPct} /><Change label="1h" v={t.change1hPct} /><Change label="24h" v={t.change24hPct} /></div>
      <dl className="num mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div><dt className="text-[#8a8478]">Vol 1h</dt><dd className="text-[#d8d2c5]">{formatUsdCompact(t.volume1hUsd)}</dd></div>
        <div><dt className="text-[#8a8478]">Vol 24h</dt><dd className="text-[#d8d2c5]">{formatUsdCompact(t.volume24hUsd)}</dd></div>
        <div><dt className="text-[#8a8478]">Liquidity</dt><dd className="text-[#d8d2c5]">{formatUsdCompact(t.liquidityUsd)}</dd></div>
      </dl>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/5 pt-2 text-[11px]">
        <span className="num text-[#8a8478]">{formatPrice(t.priceUsd)} · {t.dex}{t.boosted ? ' · boosted' : ''}</span>
        <span className="flex gap-2">
          <Link href={`/app/audit?mint=${t.mint}`} className="font-semibold text-[#c9a24a] hover:text-[#f3dc95]">Audit</Link>
          <Link href={`/app/paper?mint=${t.mint}`} className="font-semibold text-[#c9a24a] hover:text-[#f3dc95]">Paper</Link>
          {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="text-[#8a8478] hover:text-[#f3dc95]">Chart ↗</a>}
        </span>
      </div>
    </article>
  );
}

export default function SignalsPage() {
  const { data, state, error, reload } = useMovers(15_000);
  const [sort, setSort] = useState<MoverSort>('movers');
  const [q, setQ] = useState('');
  const now = useNow(5000);
  const cards = useMemo(() => {
    const all = sortMovers(data?.tokens ?? [], sort);
    const s = q.trim().toLowerCase();
    return s ? all.filter((t) => t.symbol.toLowerCase().includes(s) || t.name.toLowerCase().includes(s) || t.mint === q.trim()) : all;
  }, [data, sort, q]);
  const fresh = freshness(data?.fetchedAt, now);
  const stale = !!data && (data.stale || fresh === 'stale' || (!!error && state === 'ready'));

  return (
    <div>
      <PageHeader eyebrow="Signals scanner · Solana" title="Movers board" actions={<Refreshed at={data?.fetchedAt} stale={stale} />}>
        Live tokens trending on DexScreener, refreshed every 15 seconds. Market data only, not a recommendation; most micro-caps lose value.
      </PageHeader>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Sort">
          {MOVER_SORTS.map((s) => <button key={s.id} role="tab" aria-selected={sort === s.id} onClick={() => setSort(s.id)} className={`whitespace-nowrap border px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${sort === s.id ? 'border-[#d4af37] bg-[#d4af37]/15 text-[#f3dc95]' : 'border-white/10 text-[#a39c8f] hover:text-[#f2ede2]'}`}>{s.label}</button>)}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, ticker or mint" className="field sm:max-w-xs" aria-label="Filter tokens" />
      </div>
      <div className="mb-4 space-y-2">
        {stale && <StateBox kind="stale" title="Showing the last good board">Live refresh is failing or delayed{error ? ` (${error})` : ''}. Numbers may be out of date.</StateBox>}
        {state === 'error' && <StateBox kind="error" title="Market data unavailable" action={<button className="btn-line !py-1.5" onClick={() => void reload()}>Retry</button>}>{error}. Nothing is shown rather than guessing.</StateBox>}
        {state === 'empty' && <StateBox kind="empty" title="No Solana tokens on the board right now">DexScreener returned no Solana listings. It will refresh automatically.</StateBox>}
      </div>
      {state === 'loading' && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" data-testid="signals-loading">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="skeleton h-48" />)}</div>}
      {state === 'ready' && (
        <>
          <p className="mb-3 text-xs text-[#8a8478]" data-testid="signals-count">{cards.length} tokens{q && ` matching “${q}”`}</p>
          {cards.length === 0 ? <StateBox kind="empty" title="No tokens match that filter" /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" data-testid="signals-grid">{cards.map((t) => <Card key={t.mint} t={t} now={now} />)}</div>}
        </>
      )}
    </div>
  );
}
