import { isDemo } from '@/lib/demo';
import { COMPANY_LEGAL } from '@/lib/company';
import WalletProviders from '@/components/WalletProviders';
import Link from 'next/link';
const NAV = [['/demo', 'Home'], ['/live', 'Live'], ['/whitepaper', 'Whitepaper'], ['/demo/chart', 'Live charts'], ['/demo/brain', 'Ask Cletus'], ['/demo/wallet', 'Wallet'], ['/demo/dashboard', 'Dashboard'], ['/demo/disclaimer', 'Terms & risk'], ['/legal', 'Legal']];
const GUEST_NAV = [['/demo', 'Overview'], ['/live', 'Recorded performance'], ['/whitepaper', 'Whitepaper']];
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  const demoMode = isDemo();
  return (
    <div className="tw bg-black text-white min-h-screen">
      <header className="border-b border-amber-500/20 bg-black/80 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4 flex-wrap">
          <Link href="/demo" className="flex items-center gap-2 no-underline">
            <img src="/cletus-logo.png" alt="Cletus" className="w-8 h-8 rounded-full" />
            <span className="gold-text font-bold text-lg">Cletus</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300">PUBLIC DEMO</span>
          </Link>
          <nav className="flex gap-3 text-sm flex-wrap">
            {(demoMode ? NAV : GUEST_NAV).map(([h, l]) => <Link key={h} href={h} className="text-zinc-300 hover:text-amber-300 no-underline">{l}</Link>)}
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6"><WalletProviders>{children}</WalletProviders></main>
      <footer className="max-w-5xl mx-auto px-4 py-8 text-xs text-zinc-500 border-t border-zinc-800">
        {demoMode ? 'Demo mode: simulation only. No trading.' : 'Guest access includes the project overview and recorded results.'} Financial losses can occur.
        {' '}<Link href="/whitepaper" className="text-amber-300 hover:text-amber-200">Whitepaper</Link>
        {' · '}<a href="/cletus-whitepaper.pdf" className="text-amber-300 hover:text-amber-200">Download PDF</a>
        <div className="mt-2 text-zinc-600">© 2026 {COMPANY_LEGAL}</div>
      </footer>
    </div>
  );
}
