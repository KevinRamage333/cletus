import Link from 'next/link';
import { SITE_NAV, LEGAL_NAV, SITE_DISCLAIMER, SITE_HOST, APP_HOST } from '@/lib/site';
import { COMPANY_LINE } from '@/lib/company';

export default function SiteFooter() {
  return (
    <footer className="border-t border-[rgba(212,175,55,.16)] bg-[#030304]">
      <div className="mx-auto max-w-7xl px-5 py-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3"><img src="/cletus-logo.png" alt="" width={30} height={30} className="rounded-full" /><span className="metal text-base font-black tracking-[.28em]">CLETUS</span></div>
            <p className="mt-4 max-w-sm text-sm text-[#a39c8f]">The autonomous trading &amp; financial intelligence ecosystem. Simulation-first, transparent by design.</p>
            <p className="mt-3 text-xs text-[#6f695f]">{SITE_HOST} · {APP_HOST}</p>
          </div>
          <div><p className="eyebrow mb-3">Company</p>{SITE_NAV.map((n) => <Link key={n.href} href={n.href} className="block py-1 text-sm text-[#a39c8f] hover:text-[#e3c06a]">{n.label}</Link>)}</div>
          <div><p className="eyebrow mb-3">Platform</p>{[['/app', 'Dashboard'], ['/app/signals', 'Signals'], ['/app/paper', 'Paper Trading'], ['/app/audit', 'Cletus Audit'], ['/app/community', 'Community'], ['/app/wallet', 'Wallets'], ['/whitepaper', 'Whitepaper']].map(([h, l]) => <Link key={h} href={h} className="block py-1 text-sm text-[#a39c8f] hover:text-[#e3c06a]">{l}</Link>)}</div>
          <div><p className="eyebrow mb-3">Legal</p>{LEGAL_NAV.map((n) => <Link key={n.href} href={n.href} className="block py-1 text-sm text-[#a39c8f] hover:text-[#e3c06a]">{n.label}</Link>)}</div>
        </div>
        <div className="hair my-8" />
        <p className="text-xs leading-relaxed text-[#8a8478]" data-testid="site-disclaimer"><strong className="text-[#c9a24a]">Disclaimer.</strong> {SITE_DISCLAIMER}</p>
        <p className="mt-3 text-xs text-[#6f695f]">{COMPANY_LINE} © {new Date().getFullYear()}</p>
      </div>
    </footer>
  );
}
