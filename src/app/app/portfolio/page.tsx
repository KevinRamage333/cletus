'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount } from 'wagmi';
import { PageHeader, Refreshed, StateBox, Stat, TokenAvatar } from '@/components/app/ui';
import { useLocalPaper, useQuotes } from '@/components/app/usePaper';
import { useSolanaHoldings } from '@/components/wallet/useSolanaHoldings';
import { ChainBalance } from '@/components/wallet/EvmWalletCard';
import { EVM_CHAINS } from '@/lib/evm-wallet';
import { valueAccount } from '@/lib/local-paper';
import CletusPaperBook from '@/components/paper/CletusPaperBook';
import { formatPct } from '@/lib/movers';

const WSOL = 'So11111111111111111111111111111111111111112';
const usd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const tone = (n: number | null | undefined) => (n == null ? 'muted' : n >= 0 ? 'up' : 'down') as 'up' | 'down' | 'muted';

export default function PortfolioPage() {
  const { account } = useLocalPaper();
  const { publicKey, connected } = useWallet();
  const { address: evm, isConnected: evmConnected, chainId } = useAccount();
  const sol = useSolanaHoldings(connected ? publicKey : null, true);
  const mints = useMemo(() => [...new Set([...(account?.positions.map((p) => p.mint) ?? []), ...(connected ? [WSOL] : []), ...(sol.tokens?.slice(0, 20).map((t) => t.mint) ?? [])])].slice(0, 30), [account, connected, sol.tokens]);
  const { quotes, fetchedAt, error } = useQuotes(mints, 20_000);
  const prices = useMemo(() => Object.fromEntries(Object.values(quotes).map((q) => [q.mint, q.priceUsd])), [quotes]);
  const val = account ? valueAccount(account, prices) : null;
  const solPrice = quotes[WSOL]?.priceUsd ?? null;
  const solUsd = sol.sol != null && solPrice ? sol.sol * solPrice : null;

  return (
    <div>
      <PageHeader eyebrow="Portfolio" title="Holdings & performance" actions={<Refreshed at={fetchedAt} stale={!!error} label="Prices" />}>
        Your practice account and any connected wallets. Values without a live price show “—”, never $0.
      </PageHeader>

      <div id="cletus-paper" className="mb-8"><CletusPaperBook variant="full" /></div>

      <h3 className="mb-3 text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Your practice portfolio <span className="ml-2 border border-[#e3c06a]/40 px-1.5 py-0.5 text-[9px]">simulated</span></h3>
      {!account ? <div className="skeleton h-24" /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="portfolio-paper">
            <Stat label="Equity" value={usd(val?.equityUsd)} sub={val?.unpricedMints.length ? `${val.unpricedMints.length} position(s) without a live price` : undefined} />
            <Stat label="Cash" value={usd(account.cashUsd)} />
            <Stat label="Unrealized" value={usd(val?.unrealizedPnlUsd)} tone={tone(val?.unrealizedPnlUsd)} />
            <Stat label="Return vs start" value={val?.equityUsd == null ? '—' : formatPct(((val.equityUsd - account.startingUsd) / account.startingUsd) * 100)} tone={val?.equityUsd == null ? 'muted' : val.equityUsd >= account.startingUsd ? 'up' : 'down'} />
          </div>
          {account.positions.length === 0 ? <div className="mt-3"><StateBox kind="empty" title="No open paper positions" action={<Link href="/app/paper" className="btn-line !py-1.5">Paper desk</Link>} /></div> : (
            <ul className="mt-3 divide-y divide-white/5 border border-white/10">{account.positions.map((p) => { const px = prices[p.mint]; const v = px ? p.tokens * px : null; return <li key={p.mint} className="flex items-center gap-3 px-3 py-2.5"><TokenAvatar src={p.imageUrl} symbol={p.symbol} size={28} /><span className="flex-1 font-semibold">{p.symbol}</span><span className="num text-xs text-[#8a8478]">cost {usd(p.costUsd)}</span><span className="num w-28 text-right text-sm">{usd(v)}</span></li>; })}</ul>
          )}
        </>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Solana wallet</h3>{connected && <Refreshed at={sol.fetchedAt} stale={!!sol.error} />}</div>
          {!connected || !publicKey ? <StateBox kind="not-connected" title="No Solana wallet connected" action={<Link href="/app/wallet" className="btn-line !py-1.5">Connect</Link>} /> : (
            <div className="panel p-4" data-testid="portfolio-sol">
              <p className="num break-all text-xs text-[#8a8478]">{publicKey.toBase58()}</p>
              <p className="num mt-2 text-xl font-bold">{sol.sol == null ? '—' : `${sol.sol.toLocaleString('en-US', { maximumFractionDigits: 6 })} SOL`} <span className="text-sm text-[#8a8478]">{usd(solUsd)}</span></p>
              {sol.error && <div className="mt-2"><StateBox kind="stale" title="Wallet data could not refresh">{sol.error}</StateBox></div>}
              {sol.tokens && sol.tokens.length > 0 && <ul className="num mt-3 space-y-1 text-xs">{sol.tokens.slice(0, 20).map((t) => { const q = quotes[t.mint]; return <li key={t.mint} className="flex justify-between gap-2"><span className="truncate">{q?.symbol ?? `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`}</span><span>{t.uiAmount.toLocaleString('en-US', { maximumFractionDigits: 4 })} <span className="text-[#8a8478]">{usd(q?.priceUsd ? q.priceUsd * t.uiAmount : null)}</span></span></li>; })}</ul>}
              {sol.tokens && sol.tokens.length === 0 && <p className="mt-2 text-xs text-[#8a8478]">No SPL tokens held.</p>}
            </div>
          )}
        </section>
        <section>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">EVM wallet</h3>
          {!evmConnected || !evm ? <StateBox kind="not-connected" title="No EVM wallet connected" action={<Link href="/app/wallet" className="btn-line !py-1.5">Connect</Link>} /> : (
            <div className="panel p-4"><p className="num break-all text-xs text-[#8a8478]">{evm}</p><ul className="mt-3 space-y-1.5">{EVM_CHAINS.map((c) => <ChainBalance key={c.id} address={evm} chainId={c.id} active={c.id === chainId} />)}</ul><p className="mt-2 text-[11px] text-[#8a8478]">Native balances only; ERC-20 holdings are planned.</p></div>
          )}
        </section>
      </div>
      <p className="mt-6 text-xs text-[#8a8478]">Collective community P&amp;L is on the <Link href="/app/community" className="text-[#c9a24a] underline">Community</Link> screen.</p>
    </div>
  );
}
