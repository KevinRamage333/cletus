import { COMPANY_LEGAL } from '@/lib/company';
import { WHITEPAPER_PDF_PATH } from '@/lib/whitepaper';
import Link from 'next/link';

const NAV: Array<[string, string]> = [
  ['/demo', 'Home'],
  ['/live', 'Live'],
  ['/whitepaper', 'Whitepaper'],
  ['/demo/chart', 'Live charts'],
  ['/demo/brain', 'Ask Cletus'],
  ['/demo/wallet', 'Wallet'],
  ['/demo/dashboard', 'Dashboard'],
  ['/demo/disclaimer', 'Terms & risk'],
  ['/legal', 'Legal'],
];

export const metadata = {
  title: 'Cletus Whitepaper',
  description:
    'Cletus whitepaper and roadmap: an experimental, non-custodial AI trading system beginning on Solana. Not financial advice. No token. No guaranteed returns.',
};

export default function WhitepaperLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="tw bg-black text-white min-h-screen">
      <header className="border-b border-amber-500/20 bg-black/80 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4 flex-wrap">
          <Link href="/demo" className="flex items-center gap-2 no-underline">
            <img src="/cletus-logo.png" alt="Cletus" className="w-8 h-8 rounded-full" />
            <span className="gold-text font-bold text-lg">Cletus</span>
          </Link>
          <nav className="flex gap-3 text-sm flex-wrap">
            {NAV.map(([h, l]) => (
              <Link key={h} href={h} className="text-zinc-300 hover:text-amber-300 no-underline">
                {l}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      <footer className="max-w-5xl mx-auto px-4 py-8 text-xs text-zinc-500 border-t border-zinc-800">
        Not financial advice. No guaranteed gains; losses, including total loss, can happen. There is no Cletus token.
        The trading strategy is experimental.{' '}
        <Link href="/whitepaper" className="text-amber-300 hover:text-amber-200">
          Whitepaper
        </Link>
        {' · '}
        <a href={WHITEPAPER_PDF_PATH} className="text-amber-300 hover:text-amber-200">
          Download PDF
        </a>
        {' · '}
        <Link href="/demo/disclaimer" className="text-amber-300 hover:text-amber-200">
          Terms &amp; risk
        </Link>
        <div className="mt-2 text-zinc-600">© 2026 {COMPANY_LEGAL}</div>
      </footer>
    </div>
  );
}
