'use client';
import { useCallback, useEffect, useState } from 'react';
import ConnectWallet from '@/components/ConnectWallet';
import OwnerDashboard from '@/components/OwnerDashboard';

export default function OwnerPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  const check = useCallback(async () => {
    const r = await fetch('/api/owner/status', { cache: 'no-store', credentials: 'include' });
    setAuthed(r.ok);
  }, []);

  useEffect(() => { check(); }, [check]);

  if (authed === null) return <div className="center-page">Loading…</div>;
  if (authed) return <OwnerDashboard onSignOut={() => setAuthed(false)} />;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <p className="text-xs uppercase tracking-wider text-amber-300">Owner login</p>
        <h1 className="text-3xl font-extrabold gold-text mt-1">The Owner&apos;s Desk</h1>
        <p className="text-sm text-zinc-400 mt-2">Sign in with the Jupiter payout wallet to see the live house book, the money plan, and the sell-all switch. Anyone else is turned away.</p>
      </div>
      <ConnectWallet mode="owner" onConnected={() => setAuthed(true)} />
    </div>
  );
}
