import CommunityStats from '@/components/app/CommunityStats';
import CommunityFeed from '@/components/account/CommunityFeed';
import { isDemo } from '@/lib/demo';
export const dynamic = 'force-dynamic';

export default function CommunityPage() {
  const demo = isDemo();
  return (
    <div className="space-y-10">
      <CommunityStats demo={demo} />
      {demo
        ? <div className="panel p-5 text-sm text-[#a39c8f]"><p className="font-semibold text-[#f6f1e4]">Community discussion</p><p className="mt-1">The opt-in, moderated member feed with anonymous public labels opens for signed-in members. It is not available in the public preview.</p></div>
        : <section><h3 className="mb-3 text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Member discussion</h3><CommunityFeed /></section>}
    </div>
  );
}
