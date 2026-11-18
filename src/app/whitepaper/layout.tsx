import type { ReactNode } from 'react';
import SiteHeader from '@/components/site/SiteHeader';
import SiteFooter from '@/components/site/SiteFooter';

export const metadata = {
  title: 'Cletus Whitepaper',
  description:
    'Cletus whitepaper and roadmap: an experimental, non-custodial AI trading system beginning on Solana. Not financial advice. No token. No guaranteed returns.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="tw cx min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}
