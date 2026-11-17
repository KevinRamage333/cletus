import BottomNav from '@/components/BottomNav';
import WalletProviders from '@/components/WalletProviders';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth';
export const metadata = { title: 'Cletus' };
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <WalletProviders>
      <div className="tw bg-black text-white min-h-screen pb-20 md:pb-0"><BottomNav />{user?.isAdmin && <div className="border-b border-[#D4AF37]/20 bg-[#D4AF37]/10 px-4 py-2 text-center text-xs"><Link href="/app/operations" className="font-semibold text-[#E5C76B] hover:underline">Operations Desk · Admin access</Link></div>}{children}</div>
    </WalletProviders>
  );
}
