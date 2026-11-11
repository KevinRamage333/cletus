import BottomNav from '@/components/BottomNav';
export const metadata = { title: 'Cletus' };
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="tw bg-black text-white min-h-screen pb-20 md:pb-0"><BottomNav />{children}</div>;
}
