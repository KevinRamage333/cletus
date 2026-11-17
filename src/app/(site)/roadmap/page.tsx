import { PageHero, Section, SectionHead, StatusBadge } from '@/components/site/ui';
import { NEXT_PRIORITIES, ROADMAP, ROADMAP_VISION, STATUS_NOTE } from '@/lib/site-content';

export const metadata = { title: 'Roadmap · Cletus', description: 'Five phases from what is shipped to the longer vision. Live trading is not enabled.' };

export default function RoadmapPage() {
  return (
    <>
      <PageHero eyebrow="Roadmap" title={<>Five phases. <span className="metal">No shortcuts.</span></>}>{ROADMAP_VISION}</PageHero>
      <Section>
        <ol className="relative space-y-6 border-l border-[rgba(212,175,55,.3)] pl-8" data-testid="roadmap">
          {ROADMAP.map((p) => (
            <li key={p.n} className="relative">
              <span className="absolute -left-[42px] top-1 flex h-5 w-5 items-center justify-center rounded-full border border-[#d4af37] bg-[#050506] text-[10px] font-bold text-[#e3c06a]">{p.n}</span>
              <div className="panel p-6">
                <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold text-[#f6f1e4]"><span className="num mr-2 text-sm text-[#c9a24a]">PHASE {p.n}</span>{p.title}</h2><StatusBadge status={p.status} /></div>
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">{p.items.map((i) => <li key={i} className="flex gap-2 text-sm text-[#a39c8f]"><span className="text-[#c9a24a]">▸</span>{i}</li>)}</ul>
              </div>
            </li>
          ))}
        </ol>
      </Section>
      <Section className="!pt-0">
        <SectionHead eyebrow="Immediate priorities" title="Finish the site in simulation. No live trading yet." />
        <ol className="grid gap-3 md:grid-cols-2">{NEXT_PRIORITIES.map((p, i) => <li key={p} className="panel flex gap-3 p-4 text-[#d8d2c5]"><span className="num text-[#c9a24a]">{String(i + 1).padStart(2, '0')}</span>{p}</li>)}</ol>
        <p className="mt-8 text-xs text-[#6f695f]">{STATUS_NOTE}</p>
      </Section>
    </>
  );
}
