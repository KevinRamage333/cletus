import BottomNav from '@/components/BottomNav';
export default function L({ children }: { children: React.ReactNode }) {
  return <div className="tw bg-black text-white min-h-screen pb-20 md:pb-0"><BottomNav />{children}</div>;
}
