'use client';

import { useCallback, useState } from 'react';
import { CommunityFeed } from '@/components/CommunityFeed';
import CollectivePnlTicker from '@/components/CollectivePnlTicker';
import DevWalletAudit from '@/components/app/DevWalletAudit';

/** The single moderated member feed (#99), with the opt-in cohort P&L and the dev-wallet audit. */
export default function CommunityDiscussion() {
  const [feedKey, setFeedKey] = useState(0);
  const refresh = useCallback(() => setFeedKey((k) => k + 1), []);
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Member discussion</h3>
      <CollectivePnlTicker />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="panel p-4 lg:col-span-3"><CommunityFeed key={feedKey} /></div>
        <div className="lg:col-span-2"><DevWalletAudit onSubmitted={refresh} /></div>
      </div>
    </section>
  );
}
