import Link from 'next/link';
import { Card, Section, SectionHead, StatusBadge } from '@/components/site/ui';
import LiveMarketStrip from '@/components/site/LiveMarketStrip';
import { CLOSING, EXECUTIVE_SUMMARY, GOLD_COMMUNITY, PROBLEMS, ROADMAP, STATUS_NOTE, WHAT_WE_BUILT, WHY_DIFFERENT } from '@/lib/site-content';

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-[rgba(212,175,55,.14)]">
        <div className="grid-bg pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <div className="pointer-events-none absolute right-[-10rem] top-[-12rem] h-[38rem] w-[38rem] rounded-full bg-[#d4af37]/[.10] blur-[130px]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 sm:py-24 lg:grid-cols-[1.2fr_.8fr]">
          <div>
            <p className="eyebrow">Autonomous trading &amp; financial intelligence</p>
            <h1 className="mt-5 text-[2.75rem] font-black leading-[.98] tracking-[-.045em] text-[#f7f1e1] sm:text-7xl">
              Smarter than<br />another trading bot.<br /><span className="metal">Meet Cletus.</span>
            </h1>
            <p className="mt-7 max-w-xl border-l-2 border-[#c9a24a] pl-5 text-lg text-[#a39c8f]">
              Market analysis, signals, risk management, portfolio tracking, on-chain audits, community intelligence and an AI companion, connected in one platform built on transparency over hype.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/app" className="btn-gold">Launch the app →</Link>
              <Link href="/about" className="btn-line">Read the overview</Link>
            </div>
            <p className="mt-6 text-[11px] font-semibold uppercase tracking-[.2em] text-[#8a8478]">Simulation-first · Live trading not enabled · No guaranteed returns</p>
          </div>
          <div className="relative mx-auto w-full max-w-sm">
            <div className="absolute inset-6 rounded-full bg-[#d4af37]/15 blur-3xl" />
            <div className="panel panel-hi relative p-6 text-center">
              <img src="/cletus-logo.png" alt="Cletus, the central AI intelligence" className="mx-auto w-48 drop-shadow-[0_20px_60px_rgba(212,175,55,.35)] sm:w-60" />
              <p className="mt-4 text-[11px] font-bold uppercase tracking-[.3em] text-[#c9a24a]">Central intelligence</p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] font-bold uppercase tracking-wider">
                {['Analyze', 'Explain', 'Protect'].map((x) => <span key={x} className="border border-[rgba(212,175,55,.25)] py-2 text-[#e3c06a]">{x}</span>)}
              </div>
            </div>
          </div>
        </div>
        <LiveMarketStrip />
      </section>

      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <SectionHead eyebrow="Executive summary" title={<>An intelligent <span className="metal">financial ecosystem</span>, not a script.</>} />
          <div className="space-y-4 text-[#a39c8f]">{EXECUTIVE_SUMMARY.map((p) => <p key={p}>{p}</p>)}</div>
        </div>
      </Section>

      <div className="border-y border-[rgba(212,175,55,.12)] bg-[#08080a]">
        <Section>
          <SectionHead eyebrow="The problem" title="Crypto is full of opportunity. It is also confusing, fragmented and risky.">
            The objective is not to promise profits. It is to give people better information, better tools, greater transparency and more control.
          </SectionHead>
          <div className="grid gap-px overflow-hidden border border-[rgba(212,175,55,.14)] bg-[rgba(212,175,55,.14)] sm:grid-cols-2 lg:grid-cols-4">
            {PROBLEMS.map((p, i) => (
              <div key={p} className="bg-[#08080a] p-6"><p className="num text-xs text-[#c9a24a]">0{i + 1}</p><p className="mt-3 text-sm text-[#d8d2c5]">{p}</p></div>
            ))}
          </div>
        </Section>
      </div>

      <Section>
        <SectionHead eyebrow="What we have built" title="Honest status, every component.">Built means working code in the repository. In progress means it exists but still needs integration or production verification. Future concept means it is not built.</SectionHead>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {WHAT_WE_BUILT.map((c) => (
            <Card key={c.title} className="flex flex-col">
              <div className="flex items-start justify-between gap-3"><h3 className="text-lg font-bold text-[#f6f1e4]">{c.title}</h3><StatusBadge status={c.status} /></div>
              <p className="mt-2 text-sm text-[#a39c8f]">{c.body}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-[#d8d2c5]">{c.points.map((p) => <li key={p} className="flex gap-2"><span className="text-[#c9a24a]">▸</span>{p}</li>)}</ul>
            </Card>
          ))}
        </div>
        <div className="mt-8"><Link href="/features" className="btn-line">Explore all features</Link></div>
      </Section>

      <div className="border-y border-[rgba(212,175,55,.12)] bg-[radial-gradient(ellipse_at_top,rgba(212,175,55,.10),transparent_60%)]">
        <Section>
          <SectionHead eyebrow="The gold community" title={<>Collective intelligence, <span className="metal">privately.</span></>} />
          <div className="grid gap-4 md:grid-cols-3">{GOLD_COMMUNITY.map((g) => <Card key={g.title}><h3 className="font-bold text-[#e3c06a]">{g.title}</h3><p className="mt-2 text-sm text-[#a39c8f]">{g.body}</p></Card>)}</div>
          <div className="mt-8"><Link href="/app/community" className="btn-gold">View the community</Link></div>
        </Section>
      </div>

      <Section>
        <SectionHead eyebrow="Why Cletus is different" title="Seven capabilities. One connected ecosystem." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {WHY_DIFFERENT.map((w, i) => <Card key={w.title}><p className="num text-2xl font-black text-[#c9a24a]">{i + 1}</p><h3 className="mt-2 font-bold text-[#f6f1e4]">{w.title}</h3><p className="mt-1 text-sm text-[#a39c8f]">{w.body}</p></Card>)}
        </div>
      </Section>

      <div className="border-y border-[rgba(212,175,55,.12)] bg-[#08080a]">
        <Section>
          <SectionHead eyebrow="Roadmap" title="Five phases from foundation to ecosystem." />
          <ol className="grid gap-4 md:grid-cols-5">
            {ROADMAP.map((p) => <li key={p.n} className="panel p-5"><p className="num text-xs text-[#c9a24a]">PHASE {p.n}</p><h3 className="mt-1 font-bold text-[#f6f1e4]">{p.title}</h3><div className="mt-3"><StatusBadge status={p.status} /></div></li>)}
          </ol>
          <div className="mt-8"><Link href="/roadmap" className="btn-line">Full roadmap</Link></div>
        </Section>
      </div>

      <Section>
        <div className="panel panel-hi grid gap-8 p-8 sm:p-12 lg:grid-cols-[1.3fr_.7fr] lg:items-center">
          <div>
            <p className="eyebrow">For benefactors &amp; partners</p>
            <h2 className="mt-3 text-3xl font-extrabold text-[#f6f1e4] sm:text-4xl">Help make the foundation <span className="metal">reliable, secure and ready.</span></h2>
            <div className="mt-4 space-y-3 text-[#a39c8f]">{CLOSING.map((c) => <p key={c}>{c}</p>)}</div>
          </div>
          <div className="flex flex-col gap-3"><Link href="/sponsors" className="btn-gold">Benefactor opportunity</Link><Link href="/contact" className="btn-line">Contact the team</Link></div>
        </div>
        <p className="mt-6 text-xs text-[#6f695f]">{STATUS_NOTE}</p>
      </Section>
    </>
  );
}
