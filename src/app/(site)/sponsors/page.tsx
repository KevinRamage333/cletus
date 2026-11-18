import Link from 'next/link';
import { Card, PageHero, Section, SectionHead, StatusBadge } from '@/components/site/ui';
import { BENEFACTOR_AREAS, REVENUE_FEE_BPS, REVENUE_ILLUSTRATION, REVENUE_SPLIT, REVENUE_STREAMS, revenueRow, STAKING_AND_CHAINS } from '@/lib/site-content';

export const metadata = { title: 'Benefactors & Sponsors · Cletus', description: 'How strategic and financial support can move Cletus toward a reliable, secure and ready platform.' };
const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export default function SponsorsPage() {
  return (
    <>
      <PageHero eyebrow="Benefactors & sponsors" title={<>Support the foundation. <span className="metal">Shape the ecosystem.</span></>}>Support at this stage moves Cletus from a developing technology foundation toward a fully integrated, tested and commercially viable platform.</PageHero>
      <Section>
        <SectionHead eyebrow="The opportunity" title="Where support makes a difference">The most valuable immediate investment is in making the existing foundation reliable, secure and ready for real users.</SectionHead>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{BENEFACTOR_AREAS.map((a, i) => <div key={a} className="panel flex items-center gap-3 p-4"><span className="num text-[#c9a24a]">{String(i + 1).padStart(2, '0')}</span><span className="text-[#d8d2c5]">{a}</span></div>)}</div>
      </Section>
      <div className="border-y border-[rgba(212,175,55,.12)] bg-[#08080a]"><Section>
        <SectionHead eyebrow="Revenue model" title="How Cletus could sustain itself">None of these revenue streams is active today.</SectionHead>
        <div className="grid gap-4 md:grid-cols-3">{REVENUE_STREAMS.map((r) => <Card key={r.title}><div className="mb-3"><StatusBadge status={r.status} /></div><h3 className="font-bold text-[#f6f1e4]">{r.title}</h3><p className="mt-2 text-sm text-[#a39c8f]">{r.body}</p></Card>)}</div>
        <div className="mt-10 panel panel-hi p-6" data-testid="revenue-table">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold text-[#f6f1e4]">Illustrative fee arithmetic: {REVENUE_FEE_BPS / 100}% platform fee via Jupiter, {REVENUE_SPLIT.cletusPct}/{REVENUE_SPLIT.jupiterPct} split</h3><span className="border border-red-400/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.16em] text-red-300">Illustrative · not projections</span></div>
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
            <thead><tr className="border-b border-[rgba(212,175,55,.25)] text-[11px] uppercase tracking-[.14em] text-[#c9a24a]"><th className="py-2 pr-4">Hypothetical monthly swap volume</th><th className="py-2 pr-4">0.5% fee</th><th className="py-2 pr-4">Cletus share (80%)</th><th className="py-2">Jupiter share (20%)</th></tr></thead>
            <tbody className="num">{REVENUE_ILLUSTRATION.map((r) => { const x = revenueRow(r.monthlyVolumeUsd); return <tr key={r.monthlyVolumeUsd} className="border-b border-white/5"><td className="py-2 pr-4 text-[#f6f1e4]">{usd(x.volume)}</td><td className="py-2 pr-4 text-[#a39c8f]">{usd(x.fee)}</td><td className="py-2 pr-4 text-[#e3c06a]">{usd(x.cletus)}</td><td className="py-2 text-[#a39c8f]">{usd(x.jupiter)}</td></tr>; })}</tbody>
          </table></div>
          <p className="mt-4 text-xs text-[#8a8478]">This table only shows the arithmetic of a 0.5% fee split under the Jupiter referral program (Jupiter retains 20% of the integrator fee). The volumes are hypothetical, not forecasts, targets or projections. The fee is not active because live trading is not enabled, and actual volume may be zero.</p>
        </div>
      </Section></div>
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div><SectionHead eyebrow="Staking & token" title="Future concept, not an offer" /><p className="text-[#a39c8f]">{STAKING_AND_CHAINS.staking}</p></div>
          <div className="panel panel-hi p-8"><p className="eyebrow">Become a benefactor</p><h3 className="mt-3 text-2xl font-bold text-[#f6f1e4]">Start a conversation</h3><p className="mt-3 text-[#a39c8f]">Tell us how you would like to help: infrastructure, security, engineering, legal, data or community. Support is not an investment offering and does not confer tokens, equity or a share of revenue.</p><Link href="/contact?topic=benefactor" className="btn-gold mt-6">Contact the team</Link></div>
        </div>
      </Section>
    </>
  );
}
