import BottomNav from '@/components/BottomNav';
import WalletProviders from '@/components/WalletProviders';
export const metadata = { title: 'Cletus' };
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletProviders>
      <div className="tw bg-black text-white min-h-screen pb-20 md:pb-0"><BottomNav />{children}</div>
    </WalletProviders>
  );
}
