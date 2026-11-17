'use client';
import Link from 'next/link';
import { useMovers } from '@/components/market/useMovers';
import { formatPct, formatUsdCompact, sortMovers } from '@/lib/movers';

/** Real Solana market movement from DexScreener on the corporate home page. Market data, not recommendations. */
export default function LiveMarketStrip() {
  const { data, state } = useMovers(30_000);
  const top = data ? sortMovers(data.tokens, 'movers').slice(0, 12) : [];
  return (
    <div className="relative border-t border-[rgba(212,175,55,.14)] bg-[#070708]/80" data-testid="live-strip">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3">
        <Link href="/app/signals" className="flex shrink-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[#c9a24a]">
          {state === 'error' ? <span className="h-[7px] w-[7px] rounded-full bg-red-500" /> : <span className="live-dot" />} Solana movers
        </Link>
        <div className="flex min-w-0 flex-1 gap-5 overflow-x-auto text-xs [scrollbar-width:none]">
          {state === 'loading' && Array.from({ length: 6 }).map((_, i) => <span key={i} className="skeleton h-4 w-28 shrink-0" />)}
          {state === 'error' && <span className="text-[#8a8478]">Live market data is temporarily unavailable.</span>}
          {state === 'empty' && <span className="text-[#8a8478]">No tokens on the board right now.</span>}
          {top.map((t) => (
            <span key={t.mint} className="num flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span className="font-bold text-[#f2ede2]">{t.symbol}</span>
              <span className="text-[#8a8478]">{formatUsdCompact(t.marketCapUsd)}</span>
              <span className={(t.change5mPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatPct(t.change5mPct)}</span>
            </span>
          ))}
        </div>
        <span className="hidden shrink-0 text-[10px] text-[#6f695f] sm:block">DexScreener · not advice</span>
      </div>
    </div>
  );
}
