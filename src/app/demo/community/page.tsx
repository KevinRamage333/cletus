import Link from 'next/link';
import CollectivePnlTicker from '@/components/CollectivePnlTicker';

export default function DemoCommunityPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-8 text-white">
      <Link href="/demo" className="text-sm text-amber-300">← Cletus</Link>
      <h1 className="text-3xl font-bold">Community</h1>
      <CollectivePnlTicker demo />
      <p className="rounded-xl border border-white/10 bg-zinc-950 p-4 text-sm text-zinc-300">Community chat is available in the signed-in app when accounts are enabled.</p>
    </main>
  );
}
