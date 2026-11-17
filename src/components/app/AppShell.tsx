'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { SITE_DISCLAIMER } from '@/lib/site';

type Item = { href: string; label: string; icon: string; demo?: boolean; admin?: boolean };
const GROUPS: Array<{ title: string; items: Item[] }> = [
  { title: 'Overview', items: [{ href: '/app', label: 'Dashboard', icon: '◧', demo: true }] },
  { title: 'Markets', items: [{ href: '/app/signals', label: 'Signals', icon: '⚡', demo: true }, { href: '/app/audit', label: 'Cletus Audit', icon: '⛨', demo: true }, { href: '/app/intelligence', label: 'Token Intelligence', icon: '◎' }, { href: '/app/dev-wallet', label: 'Dev Wallet Inspector', icon: '⌕' }, { href: '/app/chart', label: 'Charts', icon: '↗' }] },
  { title: 'Trading', items: [{ href: '/app/paper', label: 'Paper Trading', icon: '▶', demo: true }, { href: '/app/portfolio', label: 'Portfolio', icon: '◔', demo: true }, { href: '/app/tax', label: 'Tax', icon: '§', demo: true }, { href: '/app/trade', label: 'Engine Simulator', icon: '⚙' }, { href: '/app/performance', label: 'Performance', icon: '▤' }, { href: '/app/base', label: 'Base Paper Desk', icon: '◆' }] },
  { title: 'Network', items: [{ href: '/app/community', label: 'Community', icon: '✦', demo: true }, { href: '/app/wallet', label: 'Wallets', icon: '◈', demo: true }, { href: '/app/ai', label: 'Cletus AI', icon: '✺' }, { href: '/app/developer-verification', label: 'Developer Verification', icon: '✓' }] },
  { title: 'Admin', items: [{ href: '/app/operations', label: 'Operations', icon: '⌘', admin: true }, { href: '/app/config', label: 'Engine Config', icon: '⚙', admin: true }] },
];
const TABS: Item[] = [{ href: '/app', label: 'Home', icon: '◧' }, { href: '/app/signals', label: 'Signals', icon: '⚡' }, { href: '/app/paper', label: 'Paper', icon: '▶' }, { href: '/app/portfolio', label: 'Portfolio', icon: '◔' }];

function SoonBanner() {
  const sp = useSearchParams();
  const soon = sp?.get('soon');
  if (!soon) return null;
  return <div className="border-b border-[#e3c06a]/30 bg-[#e3c06a]/10 px-4 py-2 text-center text-xs text-[#e3c06a]" role="status" data-testid="soon-banner">{soon} needs a signed-in account and is not available in the public preview.</div>;
}

export default function AppShell({ children, demo, isAdmin }: { children: ReactNode; demo: boolean; isAdmin: boolean }) {
  const path = usePathname() ?? '/app';
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);
  const visible = (i: Item) => (i.admin ? isAdmin && !demo : demo ? !!i.demo : true);
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length);
  const active = (h: string) => (h === '/app' ? path === '/app' : path === h || path.startsWith(h + '/'));
  const current = GROUPS.flatMap((g) => g.items).find((i) => active(i.href));

  const NavList = ({ onPick }: { onPick?: () => void }) => (
    <nav aria-label="App" className="space-y-6">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.24em] text-[#6f695f]">{g.title}</p>
          {g.items.map((i) => (
            <Link key={i.href} href={i.href} onClick={onPick} aria-current={active(i.href) ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-[3px] px-3 py-2 text-sm font-medium transition-colors ${active(i.href) ? 'bg-[#d4af37]/12 text-[#f3dc95] shadow-[inset_2px_0_0_#d4af37]' : 'text-[#a39c8f] hover:bg-white/[.03] hover:text-[#f2ede2]'}`}>
              <span className="w-4 text-center text-[#c9a24a]">{i.icon}</span>{i.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="tw cx min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-[rgba(212,175,55,.14)] bg-[#070708] lg:flex">
        <Link href="/" className="flex h-16 items-center gap-3 border-b border-[rgba(212,175,55,.14)] px-5"><img src="/cletus-logo.png" alt="" width={30} height={30} className="rounded-full ring-1 ring-[#d4af37]/40" /><span className="metal text-[15px] font-black tracking-[.28em]">CLETUS</span></Link>
        <div className="flex-1 overflow-y-auto px-3 py-5"><NavList /></div>
        <div className="border-t border-[rgba(212,175,55,.14)] p-4 text-[11px] text-[#6f695f]"><span className="inline-flex items-center gap-2 text-[#e3c06a]"><span className="h-1.5 w-1.5 rounded-full bg-[#e3c06a]" />Paper mode</span><br />Live trading disabled. <Link href="/legal/risk" className="underline">Risk</Link></div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-[rgba(212,175,55,.14)] bg-[#050506]/90 px-4 backdrop-blur-xl lg:h-16 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="lg:hidden"><img src="/cletus-logo.png" alt="Cletus" width={28} height={28} className="rounded-full" /></Link>
            <h1 className="truncate text-sm font-bold uppercase tracking-[.16em] text-[#f2ede2] lg:text-base">{current?.label ?? 'Cletus'}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 border border-[#e3c06a]/40 px-2 py-1 text-[10px] font-bold uppercase tracking-[.16em] text-[#e3c06a] sm:inline-flex" data-testid="mode-badge">Paper · Live off</span>
            {demo && <span className="hidden border border-sky-300/30 px-2 py-1 text-[10px] font-bold uppercase tracking-[.16em] text-sky-200 md:inline">Public preview</span>}
            <Link href="/app/wallet" className="btn-line !px-3 !py-2 !text-[10px]">Wallets</Link>
          </div>
        </header>
        <Suspense fallback={null}><SoonBanner /></Suspense>
        <main className="mx-auto max-w-7xl px-4 pb-28 pt-5 lg:px-8 lg:pb-12 lg:pt-8">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-28 text-[11px] leading-relaxed text-[#6f695f] lg:px-8 lg:pb-8" data-testid="app-disclaimer">{SITE_DISCLAIMER}</footer>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-[rgba(212,175,55,.25)] bg-[#070708]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Tabs">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} aria-current={active(t.href) ? 'page' : undefined} className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${active(t.href) ? 'text-[#f3dc95]' : 'text-[#8a8478]'}`}><span className="text-base leading-none">{t.icon}</span>{t.label}</Link>
        ))}
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${more ? 'text-[#f3dc95]' : 'text-[#8a8478]'}`}><span className="text-base leading-none">☰</span>More</button>
      </nav>
      {more && (
        <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-x-0 bottom-[60px] max-h-[75vh] overflow-y-auto border-t border-[rgba(212,175,55,.25)] bg-[#070708] px-3 py-5" onClick={(e) => e.stopPropagation()} data-testid="more-sheet"><NavList onPick={() => setMore(false)} /></div>
        </div>
      )}
    </div>
  );
}
