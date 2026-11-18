import CommunityStats from '@/components/app/CommunityStats';
import CommunityDiscussion from '@/components/app/CommunityDiscussion';
import CletusPaperBook from '@/components/paper/CletusPaperBook';
import { isDemo } from '@/lib/demo';
export const dynamic = 'force-dynamic';

export default function CommunityPage() {
  const demo = isDemo();
  return (
    <div className="space-y-10">
      <CletusPaperBook variant="feed" />
      <CommunityStats demo={demo} />
      {demo
        ? <div className="panel p-5 text-sm text-[#a39c8f]"><p className="font-semibold text-[#f6f1e4]">Community discussion</p><p className="mt-1">The opt-in, moderated member feed with anonymous public labels opens for signed-in members. It is not available in the public preview.</p></div>
        : <CommunityDiscussion />}
    </div>
  );
}
