import Link from 'next/link';

const networks = [
  { name: 'Solana', ticker: 'SOL', status: 'Paper scanner', href: '/app/discover' },
  { name: 'Base', ticker: 'ETH', status: 'Markets and fee previews', href: '/app/base' },
  { name: 'Ethereum', ticker: 'ETH', status: 'Wallet and balances', href: '/app/wallet' },
  { name: 'BNB Chain', ticker: 'BNB', status: 'Wallet and balances', href: '/app/wallet' },
  { name: 'Polygon', ticker: 'POL', status: 'Wallet and balances', href: '/app/wallet' },
  { name: 'Arbitrum', ticker: 'ETH', status: 'Wallet and balances', href: '/app/wallet' },
  { name: 'Avalanche', ticker: 'AVAX', status: 'Wallet and balances', href: '/app/wallet' },
  { name: 'Optimism', ticker: 'ETH', status: 'Wallet and balances', href: '/app/wallet' },
  { name: 'Robinhood Chain', ticker: 'ETH', status: 'Wallet and balances', href: '/app/wallet' },
  { name: 'Monad', ticker: 'MON', status: 'Wallet and balances', href: '/app/wallet' },
  { name: 'Cronos', ticker: 'CRO', status: 'Planned' },
  { name: 'Sui', ticker: 'SUI', status: 'Planned' },
] as const;

export default function TradingNetworks({ demo = false }: { demo?: boolean }) {
  return (
    <section className="rounded-2xl border border-amber-300/20 bg-zinc-950 p-4" aria-label="Trading networks">
      <h2 className="mb-3 text-base font-semibold text-white">Networks</h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3">
        {networks.map((network) => {
          const href = demo ? (network.name === 'Solana' ? '/demo/chart' : null) : ('href' in network ? network.href : null);
          const status = demo && network.name === 'Solana' ? 'Live chart' : network.status;
          const content = <><span className="flex flex-wrap items-baseline gap-x-2"><strong className="text-sm text-white">{network.name}</strong><small className="text-amber-300/75">{network.ticker}</small></span><span className="mt-1 block text-xs text-zinc-400">{status}</span></>;
          return <li key={network.name} className="min-w-0">{href
            ? <Link className="block h-full rounded-xl border border-white/10 bg-white/5 p-3 no-underline hover:border-amber-300/60 focus-visible:outline focus-visible:outline-amber-300" href={href}>{content}</Link>
            : <div className="h-full rounded-xl border border-white/10 p-3">{content}</div>}
          </li>;
        })}
      </ul>
    </section>
  );
}
