import type { ReactNode } from 'react';
import { COMPANY_LEGAL } from '@/lib/company';
import Link from 'next/link';

const NAV = [['/demo', 'Home'], ['/live', 'Live'], ['/whitepaper', 'Whitepaper'], ['/demo/chart', 'Live charts'], ['/demo/brain', 'Ask Cletus'], ['/demo/wallet', 'Wallet'], ['/demo/dashboard', 'Dashboard'], ['/legal', 'Legal']];

export const metadata = { title: 'Cletus live recorded book', description: 'Anonymized recorded trades from Cletus. Not financial advice. Past results do not predict future results.' };

export default function LiveLayout({ children }: { children: ReactNode }) {
  return (
    <div className="tw bg-black text-white min-h-screen">
      <header className="border-b border-amber-500/20 bg-black/80 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4 flex-wrap">
          <Link href="/demo" className="flex items-center gap-2 no-underline">
            <img src="/cletus-logo.png" alt="Cletus" className="w-8 h-8 rounded-full" />
            <span className="gold-text font-bold text-lg">Cletus</span>
          </Link>
          <nav className="flex gap-3 text-sm flex-wrap">
            {NAV.map(([h, l]) => <Link key={h} href={h} className="text-zinc-300 hover:text-amber-300 no-underline">{l}</Link>)}
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      <footer className="max-w-5xl mx-auto px-4 py-8 text-xs text-zinc-500 border-t border-zinc-800">
        Not financial advice. Past results, including simulated or paper results, do not predict future results. Losses, including total loss, can occur.
        {' '}<Link href="/whitepaper" className="text-amber-300 hover:text-amber-200">Whitepaper</Link>
        {' · '}<a href="/cletus-whitepaper.pdf" className="text-amber-300 hover:text-amber-200">Download PDF</a>
        <div className="mt-2 text-zinc-600">© 2026 {COMPANY_LEGAL}</div>
      </footer>
    </div>
  );
}
