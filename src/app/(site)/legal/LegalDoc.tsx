import type { ReactNode } from 'react';
import Link from 'next/link';
import { LEGAL_NAV } from '@/lib/site';

export default function LegalDoc({ title, updated, children, current }: { title: string; updated: string; children: ReactNode; current: string }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[220px_1fr]">
      <aside className="lg:sticky lg:top-24 lg:self-start"><p className="eyebrow mb-3">Legal</p><nav className="flex flex-wrap gap-2 lg:flex-col">{LEGAL_NAV.map((l) => <Link key={l.href} href={l.href} className={`text-sm ${l.href === current ? 'text-[#e3c06a]' : 'text-[#a39c8f] hover:text-[#f2ede2]'}`}>{l.label}</Link>)}</nav></aside>
      <article className="prose-cx max-w-3xl">
        <h1 className="text-3xl font-black tracking-tight text-[#f6f1e4] sm:text-4xl">{title}</h1>
        <p className="mt-2 text-xs uppercase tracking-[.16em] text-[#8a8478]">Last updated {updated} · Template language, pending legal review</p>
        <div className="hair my-6" />
        {children}
      </article>
    </div>
  );
}
