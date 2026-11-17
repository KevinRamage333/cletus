import AppShell from '@/components/app/AppShell';
import WalletProviders from '@/components/WalletProviders';
import { getSessionUser } from '@/lib/auth';
import { isDemo } from '@/lib/demo';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cletus App', description: 'Signals, paper trading, portfolio, tax, audit, community and wallets. Paper mode; live trading disabled.' };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const demo = isDemo();
  // The public preview has no database; never query it there.
  const user = demo ? null : await getSessionUser().catch(() => null);
  return (
    <WalletProviders>
      <AppShell demo={demo} isAdmin={!!user?.isAdmin}>{children}</AppShell>
    </WalletProviders>
  );
}
