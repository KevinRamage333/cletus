'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import ConnectWallet from '@/components/ConnectWallet';
import ApprovalQueue from '@/components/ApprovalQueue';
import LivePortfolio from '@/components/LivePortfolio';
import { demoPortfolio } from '@/lib/demo-dashboard';

function DemoDash() {
  const data = useMemo(() => demoPortfolio(), []);
  const [connected, setConnected] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
        Public demo preview of the live dashboard. Accounts and real trading are not open yet. Numbers below are illustrative paper results, not a promise of returns.
      </div>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider text-amber-300">Your performance</p>
          <h1 className="text-3xl font-extrabold gold-text mt-1">Dashboard</h1>
          <p className="text-sm text-zinc-400 mt-1">{connected ? `Connected · ${connected.slice(0, 4)}…${connected.slice(-4)}` : 'Paper mode · just watching'}</p>
        </div>
        <Link href="/demo/wallet" className="text-sm text-amber-300">Wallet step</Link>
      </div>
      <ConnectWallet
        mode="demo"
        currentPublicKey={connected}
        source={connected ? 'connected' : 'paper'}
        onConnected={setConnected}
        onDisconnected={() => setConnected(null)}
        onPaper={() => setConnected(null)}
      />
      <ApprovalQueue approvals={data.approvals} demo />
      <LivePortfolio
        equity={data.equity}
        cash={data.cash}
        startingBalance={data.startingBalance}
        realizedPnl={data.realizedPnl}
        unrealizedPnl={data.unrealizedPnl}
        totalPnl={data.totalPnl}
        winRate={data.winRate}
        closedTrades={data.closedTrades}
        open={data.open}
        closed={data.closed}
        operatorFeeBps={data.operatorFeeBps}
        demo
      />
    </div>
  );
}

export default function DemoDashboardPage() {
  return <DemoDash />;
}
