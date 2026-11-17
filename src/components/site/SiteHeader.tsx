'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { SITE_NAV } from '@/lib/site';

export default function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-[rgba(212,175,55,.16)] bg-[#050506]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5">
        <Link href="/" className="flex items-center gap-3" aria-label="Cletus home">
          <img src="/cletus-logo.png" alt="" width={34} height={34} className="rounded-full ring-1 ring-[#d4af37]/40" />
          <span className="leading-none">
            <span className="metal block text-[17px] font-black tracking-[.28em]">CLETUS</span>
            <span className="hidden text-[9px] font-semibold tracking-[.32em] text-[#a39c8f] sm:block">TECHNOLOGY</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {SITE_NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`px-3 py-2 text-[12px] font-semibold uppercase tracking-[.14em] transition-colors ${path === n.href ? 'text-[#e3c06a]' : 'text-[#a39c8f] hover:text-[#f2ede2]'}`}>{n.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/app" className="btn-gold !px-4 !py-2.5" data-testid="open-app">Launch App</Link>
          <button type="button" className="flex h-10 w-10 items-center justify-center border border-[rgba(212,175,55,.3)] lg:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span className="text-[#e3c06a]">{open ? '✕' : '☰'}</span>
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-[rgba(212,175,55,.16)] bg-[#050506] px-5 py-3 lg:hidden" aria-label="Mobile">
          {SITE_NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={`block border-b border-white/5 py-3 text-sm font-semibold uppercase tracking-[.14em] ${path === n.href ? 'text-[#e3c06a]' : 'text-[#d8d2c5]'}`}>{n.label}</Link>
          ))}
          <Link href="/legal" onClick={() => setOpen(false)} className="block py-3 text-sm font-semibold uppercase tracking-[.14em] text-[#a39c8f]">Legal</Link>
        </nav>
      )}
    </header>
  );
}
