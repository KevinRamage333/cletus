import Link from 'next/link';
import { Card, PageHero, Section, SectionHead, StatusBadge } from '@/components/site/ui';
import { CLOSING, COMPANION, EXECUTIVE_SUMMARY, PROBLEMS, STATUS_NOTE, TRUST_PRINCIPLES, WHY_DIFFERENT } from '@/lib/site-content';
import { COMPANY_LINE } from '@/lib/company';

export const metadata = { title: 'About Cletus', description: 'Cletus is being built as an intelligent, transparent, community-driven financial technology ecosystem.' };

export default function AboutPage() {
  return (
    <>
      <PageHero eyebrow="About Cletus" title={<>More than a tool. An <span className="metal">intelligent financial ecosystem.</span></>}>
        Cletus is the central AI intelligence of the platform: it analyzes markets, explains its reasoning, and helps people manage risk with transparency over hype.
      </PageHero>
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div><SectionHead eyebrow="Executive summary" title="Why Cletus exists" /><div className="space-y-4 text-[#a39c8f]">{EXECUTIVE_SUMMARY.map((p) => <p key={p}>{p}</p>)}</div></div>
          <Card className="self-start"><p className="eyebrow">The problem</p><ul className="mt-4 space-y-3">{PROBLEMS.map((p) => <li key={p} className="flex gap-3 text-sm text-[#d8d2c5]"><span className="text-[#c9a24a]">—</span>{p}</li>)}</ul></Card>
        </div>
      </Section>
      <div className="border-y border-[rgba(212,175,55,.12)] bg-[#08080a]"><Section>
        <SectionHead eyebrow="Companion & virtual-world vision" title="Cletus as a digital companion">The longer-term vision is a trusted companion that teaches, explains and remembers what you choose to share. Most of this is not built yet, and is labeled that way.</SectionHead>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{COMPANION.map((c) => <Card key={c.title}><div className="mb-3"><StatusBadge status={c.status} /></div><h3 className="font-bold text-[#f6f1e4]">{c.title}</h3><p className="mt-2 text-sm text-[#a39c8f]">{c.body}</p></Card>)}</div>
      </Section></div>
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div><SectionHead eyebrow="Security, trust & responsibility" title="Principles we build around" /><ul className="space-y-3">{TRUST_PRINCIPLES.map((t) => <li key={t} className="flex gap-3 text-[#d8d2c5]"><span className="mt-1 text-[#c9a24a]">◆</span>{t}</li>)}</ul></div>
          <div><SectionHead eyebrow="Why different" title="One connected ecosystem" /><div className="grid gap-3 sm:grid-cols-2">{WHY_DIFFERENT.map((w) => <div key={w.title} className="border-l-2 border-[#c9a24a]/60 pl-4"><p className="font-semibold text-[#f6f1e4]">{w.title}</p><p className="text-sm text-[#a39c8f]">{w.body}</p></div>)}</div></div>
        </div>
      </Section>
      <Section className="!pt-0">
        <div className="panel panel-hi p-8"><p className="eyebrow">Closing vision</p><div className="mt-4 space-y-3 text-lg text-[#d8d2c5]">{CLOSING.map((c) => <p key={c}>{c}</p>)}</div><p className="mt-4 text-lg font-semibold text-[#e3c06a]">Cletus is being built to become more than a tool. It is being built to become an intelligent financial ecosystem.</p>
          <div className="mt-6 flex flex-wrap gap-3"><Link href="/roadmap" className="btn-gold">See the roadmap</Link><Link href="/whitepaper" className="btn-line">Whitepaper</Link></div></div>
        <p className="mt-6 text-xs text-[#6f695f]">{STATUS_NOTE} {COMPANY_LINE}</p>
      </Section>
    </>
  );
}
