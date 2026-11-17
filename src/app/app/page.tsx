'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount } from 'wagmi';
import { PageHeader, Refreshed, StateBox, Stat, TokenAvatar } from '@/components/app/ui';
import { useMovers } from '@/components/market/useMovers';
import { useLocalPaper, useQuotes } from '@/components/app/usePaper';
import CletusPaperBook from '@/components/paper/CletusPaperBook';
import EngineAccountPanel from '@/components/app/EngineAccountPanel';
import { valueAccount } from '@/lib/local-paper';
import { formatPct, formatUsdCompact, freshness, sortMovers } from '@/lib/movers';

const usd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export default function DashboardPage() {
  const { data, state, error } = useMovers(20_000);
  const { account } = useLocalPaper();
  const { connected, publicKey } = useWallet();
  const { isConnected: evmConnected, address } = useAccount();
  const { quotes, fetchedAt } = useQuotes(account?.positions.map((p) => p.mint) ?? [], 20_000);
  const val = account ? valueAccount(account, Object.fromEntries(Object.values(quotes).map((q) => [q.mint, q.priceUsd]))) : null;
  const top = useMemo(() => (data ? sortMovers(data.tokens, 'movers').slice(0, 6) : []), [data]);
  const totalVol = data?.tokens.reduce((s, t) => s + (t.volume1hUsd ?? 0), 0) ?? null;
  const gainers = data?.tokens.filter((t) => (t.change1hPct ?? 0) > 0).length ?? null;
  const stale = !!data && (data.stale || freshness(data.fetchedAt) === 'stale' || !!error);

  return (
    <div>
      <PageHeader eyebrow="Command center" title={<>Good to see you. <span className="metal">Cletus is watching the market.</span></>}>
        A live view of the Solana board, your practice account and your wallets. Everything here is simulated or read-only; live trading is disabled.
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="dash-stats">
        <Stat label="Tokens on the board" value={state === 'loading' ? '…' : data ? data.tokens.length : '—'} sub={state === 'error' ? 'Market data unavailable' : <Refreshed at={data?.fetchedAt} stale={stale} />} />
        <Stat label="Up in the last hour" value={gainers == null ? '—' : `${gainers} / ${data!.tokens.length}`} sub="Share of board tokens" />
        <Stat label="Board volume (1h)" value={totalVol == null ? '—' : formatUsdCompact(totalVol)} sub="Sum across listed pools" />
        <Stat label="Your practice equity" value={usd(val?.equityUsd)} sub={account?.positions.length ? <Refreshed at={fetchedAt} label="Marked" /> : 'No open positions'} />
      </div>

      <CletusPaperBook variant="compact" />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_.6fr]">
        <section>
          <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Top movers right now</h3><Link href="/app/signals" className="text-xs font-semibold text-[#c9a24a]">Full board →</Link></div>
          {state === 'loading' && <div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-16" />)}</div>}
          {state === 'error' && <StateBox kind="error" title="Market data unavailable">{error}</StateBox>}
          {state === 'empty' && <StateBox kind="empty" title="The board is empty right now" />}
          {top.length > 0 && <div className="grid gap-2 sm:grid-cols-2" data-testid="dash-movers">{top.map((t) => (
            <Link key={t.mint} href={`/app/audit?mint=${t.mint}`} className="panel flex items-center gap-3 p-3 hover:border-[rgba(212,175,55,.45)]">
              <TokenAvatar src={t.imageUrl} symbol={t.symbol} size={40} />
              <div className="min-w-0 flex-1"><p className="truncate font-semibold text-[#f6f1e4]">{t.symbol}</p><p className="num text-xs text-[#8a8478]">mcap {formatUsdCompact(t.marketCapUsd)}</p></div>
              <div className="num text-right text-xs"><p className={(t.change5mPct ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}>5m {formatPct(t.change5mPct)}</p><p className={(t.change1hPct ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}>1h {formatPct(t.change1hPct)}</p></div>
            </Link>))}</div>}
        </section>
        <aside className="space-y-4">
          <div className="panel p-4"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#8a8478]">Safety status</p>
            <ul className="mt-3 space-y-2 text-sm"><li className="flex justify-between"><span>Mode</span><span className="font-semibold text-[#e3c06a]">Paper</span></li><li className="flex justify-between"><span>Live trading</span><span className="font-semibold text-red-300">Disabled</span></li><li className="flex justify-between"><span>Custody</span><span className="font-semibold text-green-300">Non-custodial</span></li></ul></div>
          <div className="panel p-4"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#8a8478]">Wallets</p>
            <ul className="mt-3 space-y-2 text-sm"><li className="flex justify-between gap-2"><span>Solana</span><span className="num truncate text-xs">{connected && publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : <span className="text-[#8a8478]">not connected</span>}</span></li><li className="flex justify-between gap-2"><span>EVM</span><span className="num truncate text-xs">{evmConnected && address ? `${address.slice(0, 6)}…${address.slice(-4)}` : <span className="text-[#8a8478]">not connected</span>}</span></li></ul>
            <Link href="/app/wallet" className="btn-line mt-3 w-full !py-2">Manage wallets</Link></div>
          <div className="grid grid-cols-2 gap-2">{[['/app/paper', 'Paper trade'], ['/app/audit', 'Audit a token'], ['/app/portfolio', 'Portfolio'], ['/app/community', 'Community']].map(([h, l]) => <Link key={h} href={h} className="panel p-3 text-center text-xs font-semibold uppercase tracking-wider text-[#d8d2c5] hover:text-[#f3dc95]">{l}</Link>)}</div>
        </aside>
      </div>
      <EngineAccountPanel />
    </div>
  );
}
