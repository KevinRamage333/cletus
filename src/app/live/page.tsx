import Link from 'next/link';
import PublicLiveFeed from '@/components/PublicLiveFeed';
import FeedChart from '@/components/charts/FeedChart';

export default function LivePage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-amber-300">Public live feed</p>
        <h1 className="text-3xl md:text-4xl font-extrabold gold-text mt-1">Recorded trades, as they close</h1>
        <p className="text-sm text-zinc-400 mt-2 max-w-2xl">Aggregate P&amp;L, win rate, and a ticker of closed trades across Cletus (house) and users. Wallets stay private unless a trader opts in. Numbers are recorded closes only — never sample data.</p>
      </div>
      <Link href="/live/paper" className="font-semibold text-amber-300">Paper trading report</Link>
      <div className="cx"><FeedChart /></div>
      <PublicLiveFeed />
    </div>
  );
}
