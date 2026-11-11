import type { ReactNode } from 'react';
import WalletProviders from '@/components/WalletProviders';
import { COMPANY_LEGAL } from '@/lib/company';
import Link from 'next/link';

export const metadata = { title: 'Cletus owner desk', robots: { index: false, follow: false } };

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="tw bg-black text-white min-h-screen">
      <header className="border-b border-amber-500/20 bg-black/80 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/owner" className="flex items-center gap-2 no-underline">
            <img src="/cletus-logo.png" alt="Cletus" className="w-8 h-8 rounded-full" />
            <span className="gold-text font-bold text-lg">Cletus</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300">OWNER</span>
          </Link>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6"><WalletProviders>{children}</WalletProviders></main>
      <footer className="max-w-5xl mx-auto px-4 py-8 text-xs text-zinc-500 border-t border-zinc-800">
        Not financial advice. Past results do not predict future results. Losses, including total loss, can occur.
        <div className="mt-2 text-zinc-600">© 2026 {COMPANY_LEGAL}</div>
      </footer>
    </div>
  );
}
