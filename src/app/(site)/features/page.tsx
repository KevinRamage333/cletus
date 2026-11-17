import Link from 'next/link';
import { Card, PageHero, Section, SectionHead, StatusBadge } from '@/components/site/ui';
import { GOLD_COMMUNITY, STAKING_AND_CHAINS, WHAT_WE_BUILT } from '@/lib/site-content';

export const metadata = { title: 'Features · Cletus', description: 'Signals, paper trading, portfolio, tax reporting, Cletus Audit, community and multi-chain wallets.' };

const APP_FEATURES = [
  { t: 'Signals scanner', href: '/app/signals', d: 'A live board of Solana tokens with market cap, 5m and 1h movement, volume and age, from DexScreener.' },
  { t: 'Paper trading', href: '/app/paper', d: 'Practice buys and sells against real prices with simulated fills and fees. No real funds.' },
  { t: 'Portfolio', href: '/app/portfolio', d: 'Paper positions and connected-wallet balances, each with a last-refreshed time.' },
  { t: 'Tax view', href: '/app/tax', d: 'Realized gain and loss records from your trades, exportable as CSV. Not tax advice.' },
  { t: 'Cletus Audit', href: '/app/audit', d: 'Mint and freeze authority, holder concentration and liquidity for any Solana token.' },
  { t: 'Cletus Verified', href: '/app/verified', d: 'Token developers prove wallet control and pass an automated audit to earn an expiring gold badge. Not an endorsement.' },
  { t: 'Token Boost', href: '/app/boost', d: 'Clearly labelled paid placement on the Signals board. Never affects trading. Payments coming soon.' },
  { t: 'Community', href: '/app/community', d: 'People Cletus trades for, collective P&L, tokens per network and network coverage.' },
  { t: 'Wallets', href: '/app/wallet', d: 'Phantom, Solflare, Backpack, MetaMask, Coinbase Wallet and other injected wallets.' },
  { t: 'Cletus AI', href: '/app/ai', d: 'A research assistant that explains context. It cannot place trades.' },
];

export default function FeaturesPage() {
  return (
    <>
      <PageHero eyebrow="Features" title={<>Everything connected, <span className="metal">nothing hidden.</span></>}>Each feature below links to the working screen in the app. Status labels show what is built and what is still on the way.</PageHero>
      <Section>
        <SectionHead eyebrow="In the app" title="The Cletus application" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{APP_FEATURES.map((f) => <Link key={f.t} href={f.href} className="panel group block p-6 transition-colors hover:border-[rgba(212,175,55,.45)]"><h3 className="font-bold text-[#f6f1e4] group-hover:text-[#e3c06a]">{f.t} →</h3><p className="mt-2 text-sm text-[#a39c8f]">{f.d}</p></Link>)}</div>
      </Section>
      <div className="border-y border-[rgba(212,175,55,.12)] bg-[#08080a]"><Section>
        <SectionHead eyebrow="Capabilities" title="Development status by area" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{WHAT_WE_BUILT.map((c) => <Card key={c.title}><div className="flex items-start justify-between gap-3"><h3 className="font-bold text-[#f6f1e4]">{c.title}</h3><StatusBadge status={c.status} /></div><ul className="mt-3 space-y-1 text-sm text-[#a39c8f]">{c.points.map((p) => <li key={p}>▸ {p}</li>)}</ul></Card>)}</div>
      </Section></div>
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div><SectionHead eyebrow="Multi-chain" title="Network coverage" />
            <ul className="space-y-3">{STAKING_AND_CHAINS.networks.map((n) => <li key={n.id} className="flex items-start justify-between gap-3 border-b border-white/5 pb-3"><div><p className="font-semibold text-[#f6f1e4]">{n.name}</p><p className="text-sm text-[#a39c8f]">{n.note}</p></div><StatusBadge status={n.status} /></li>)}</ul></div>
          <div><SectionHead eyebrow="Staking & token" title="Future concept only" /><Card><StatusBadge status="future" /><p className="mt-3 text-[#a39c8f]">{STAKING_AND_CHAINS.staking}</p></Card>
            <div className="mt-8"><SectionHead eyebrow="Gold community" title="Community, privately" /><div className="space-y-3">{GOLD_COMMUNITY.map((g) => <p key={g.title} className="text-sm text-[#a39c8f]"><strong className="text-[#e3c06a]">{g.title}.</strong> {g.body}</p>)}</div></div></div>
        </div>
      </Section>
    </>
  );
}
