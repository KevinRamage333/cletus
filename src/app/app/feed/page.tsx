import PublicLiveFeed from '@/components/PublicLiveFeed';
import FeedChart from '@/components/charts/FeedChart';
import { PageHeader } from '@/components/app/ui';
import CletusPaperBook from '@/components/paper/CletusPaperBook';
export const dynamic = 'force-dynamic';

export default function FeedPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Live feed" title="Trades as they close, charts as they move">
        Recorded closes from Cletus and members (paper trades are labelled), with a live price chart for any token in the feed or on the movers board. Market data only, not advice.
      </PageHeader>
      <FeedChart />
      <CletusPaperBook variant="feed" />
      <PublicLiveFeed />
    </div>
  );
}
