import { Card, PageHero, Section, SectionHead, StatusBadge } from '@/components/site/ui';
import { NEXT_PRIORITIES, TECH_STACK, WHAT_WE_BUILT } from '@/lib/site-content';

export const metadata = { title: 'Technology · Cletus', description: 'The Cletus technology stack, architecture and safety controls.' };

const ARCH = [
  { t: 'Market data', d: 'DexScreener, GeckoTerminal and Jupiter feeds normalized into one token model. Missing values stay unknown, never zero.' },
  { t: 'Signal engine', d: 'Composite scoring of momentum, volume, liquidity and holder structure, with explicit rejection reasons.' },
  { t: 'Risk layer', d: 'Pre-entry gates, stop-loss and take-profit evaluated before other exits, drawdown limits and a global kill switch.' },
  { t: 'Simulation', d: 'Paper fills on a constant-product pool model with fees and price impact, so practice results stay realistic.' },
  { t: 'Wallets', d: 'Non-custodial connections. Cletus never asks for private keys or seed phrases.' },
  { t: 'Audit & ledger', d: 'On-chain authority and concentration checks; moderation and approvals recorded in an audit trail.' },
];

export default function TechnologyPage() {
  return (
    <>
      <PageHero eyebrow="Technology" title={<>Engineered for <span className="metal">transparency and safety.</span></>}>A modern TypeScript stack with real public data sources, a simulation-first execution model and fail-safe defaults.</PageHero>
      <Section>
        <SectionHead eyebrow="Architecture" title="How the pieces connect" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{ARCH.map((a, i) => <Card key={a.t}><p className="num text-xs text-[#c9a24a]">LAYER {i + 1}</p><h3 className="mt-1 text-lg font-bold text-[#f6f1e4]">{a.t}</h3><p className="mt-2 text-sm text-[#a39c8f]">{a.d}</p></Card>)}</div>
      </Section>
      <div className="border-y border-[rgba(212,175,55,.12)] bg-[#08080a]"><Section>
        <SectionHead eyebrow="Technology stack" title="What it runs on" />
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm" data-testid="tech-stack">
          <thead><tr className="border-b border-[rgba(212,175,55,.25)] text-[11px] uppercase tracking-[.16em] text-[#c9a24a]"><th className="py-3 pr-4">Layer</th><th className="py-3 pr-4">Technology</th><th className="py-3">Status</th></tr></thead>
          <tbody>{TECH_STACK.map((r) => <tr key={r.layer} className="border-b border-white/5"><td className="py-3 pr-4 font-semibold text-[#f6f1e4]">{r.layer}</td><td className="py-3 pr-4 text-[#a39c8f]">{r.tech}</td><td className="py-3"><StatusBadge status={r.status} /></td></tr>)}</tbody>
        </table></div>
      </Section></div>
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div><SectionHead eyebrow="Component status" title="Built, in progress, future" /><ul className="space-y-3">{WHAT_WE_BUILT.map((c) => <li key={c.title} className="flex items-center justify-between gap-3 border-b border-white/5 pb-3"><span className="text-[#d8d2c5]">{c.title}</span><StatusBadge status={c.status} /></li>)}</ul></div>
          <div><SectionHead eyebrow="Next priorities" title="Better, safer, more understandable trades" /><ol className="space-y-3">{NEXT_PRIORITIES.map((p, i) => <li key={p} className="flex gap-3 text-[#d8d2c5]"><span className="num text-[#c9a24a]">{String(i + 1).padStart(2, '0')}</span>{p}</li>)}</ol></div>
        </div>
      </Section>
    </>
  );
}
