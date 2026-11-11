import Link from 'next/link';
import {
  DISCLAIMER_PARAS,
  DISCLAIMER_TITLE,
  PHASES,
  SECTIONS,
  WHITEPAPER_ABSTRACT,
  WHITEPAPER_DATE,
  WHITEPAPER_PDF_PATH,
  WHITEPAPER_TAGLINE,
  WHITEPAPER_TITLE,
  WHITEPAPER_VERSION,
} from '@/lib/whitepaper';
import { COMPANY_LEGAL } from '@/lib/company';

function Blocks({ blocks }: { blocks: (typeof SECTIONS)[number]['blocks'] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'p') {
          return (
            <p key={i} className="text-zinc-300 leading-relaxed mt-3">
              {b.text}
            </p>
          );
        }
        if (b.type === 'callout') {
          return (
            <p key={i} className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100 leading-relaxed">
              {b.text}
            </p>
          );
        }
        return (
          <ul key={i} className="mt-3 space-y-2 text-zinc-300 leading-relaxed list-disc pl-5" style={{ listStyleType: 'disc', paddingLeft: '1.25rem' }}>
            {b.items.map((item) => (
              <li key={item.slice(0, 48)} className="pl-1">
                {item}
              </li>
            ))}
          </ul>
        );
      })}
    </>
  );
}

export default function WhitepaperPage() {
  return (
    <article className="space-y-10">
      <header className="grid md:grid-cols-[1fr_auto] gap-6 items-start">
        <div>
          <p className="text-xs uppercase tracking-wider text-amber-300">Cletus Technologies LLC</p>
          <h1 className="text-4xl md:text-5xl font-extrabold leading-tight mt-2">{WHITEPAPER_TITLE}</h1>
          <p className="text-zinc-300 mt-3 text-lg">{WHITEPAPER_TAGLINE}</p>
          <p className="text-sm text-zinc-500 mt-3">
            Version {WHITEPAPER_VERSION} · {WHITEPAPER_DATE} · {COMPANY_LEGAL}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <a
            href={WHITEPAPER_PDF_PATH}
            className="px-4 py-2 rounded-lg bg-amber-400 text-black font-semibold no-underline text-center"
          >
            Download PDF
          </a>
          <Link href="/demo/disclaimer" className="px-4 py-2 rounded-lg border border-amber-400 text-amber-300 font-semibold no-underline text-center">
            Terms &amp; risk
          </Link>
        </div>
      </header>

      <div className="rounded-2xl overflow-hidden border border-amber-500/30">
        <img src="/cletus-hero.jpg" alt="Cletus, the golden goose" className="w-full max-h-64 object-cover object-center" />
      </div>

      <section className="rounded-xl border border-amber-500/30 bg-zinc-950 p-5">
        <h2 className="text-xl font-bold gold-text">Abstract</h2>
        <p className="text-zinc-300 leading-relaxed mt-3">{WHITEPAPER_ABSTRACT}</p>
      </section>

      <nav className="rounded-xl border border-zinc-800 bg-zinc-950 p-5" aria-label="Contents">
        <h2 className="text-sm font-semibold text-amber-300 uppercase tracking-wider">Contents</h2>
        <ul className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-zinc-400" style={{ listStyle: 'none', padding: 0 }}>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="hover:text-amber-300 no-underline">
                {s.title}
              </a>
            </li>
          ))}
          <li>
            <a href="#disclaimer" className="hover:text-amber-300 no-underline">
              Important disclaimer
            </a>
          </li>
        </ul>
      </nav>

      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-24">
          <h2 className="text-2xl font-bold gold-text">{s.title}</h2>
          <Blocks blocks={s.blocks} />
          {s.id === 'roadmap' && (
            <ol className="mt-6 space-y-4" style={{ listStyle: 'none', padding: 0 }}>
              {PHASES.map((p) => (
                <li key={p.id} id={p.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="text-xs uppercase tracking-wider text-amber-300">{p.phase}</span>
                    <h3 className="text-lg font-semibold text-white">{p.name}</h3>
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300">{p.status}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-2">
                    <span className="text-zinc-400">Gate: </span>
                    {p.gate}
                  </p>
                  <p className="text-zinc-300 leading-relaxed mt-3">{p.body}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}

      <section id="disclaimer" className="scroll-mt-24 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
        <h2 className="text-2xl font-bold text-amber-300">{DISCLAIMER_TITLE}</h2>
        {DISCLAIMER_PARAS.map((p) => (
          <p key={p.slice(0, 40)} className="text-zinc-300 leading-relaxed mt-3">
            {p}
          </p>
        ))}
      </section>
    </article>
  );
}
