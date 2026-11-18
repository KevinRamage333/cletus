import type { ReactNode } from 'react';
import SiteHeader from '@/components/site/SiteHeader';
import SiteFooter from '@/components/site/SiteFooter';

export const metadata = { title: 'Cletus live recorded book', description: 'Anonymized recorded trades from Cletus. Not financial advice. Past results do not predict future results.' };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="tw cx min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}
