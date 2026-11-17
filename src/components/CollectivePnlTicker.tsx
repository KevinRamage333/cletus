'use client';

import Link from 'next/link';

import { useEffect, useState } from 'react';

type CollectivePnl = {
  netProfit: number;
  totalGains: number;
  totalLosses: number;
  activeUsers: number;
  updatedAt: string;
};

const EMPTY: CollectivePnl = {
  netProfit: 0,
  totalGains: 0,
  totalLosses: 0,
  activeUsers: 0,
  updatedAt: '',
};

function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
}

export default function CollectivePnlTicker({ demo = false, showCommunityLink = false }: { demo?: boolean; showCommunityLink?: boolean }) {
  const [data, setData] = useState<CollectivePnl>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    if (demo) return;
    let stopped = false;
    async function refresh() {
      try {
        const response = await fetch('/api/community/collective-pnl', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Collective P&L unavailable');
        const payload = await response.json();
        if (stopped) return;
        setData({
          netProfit: Number(payload.netProfit) || 0,
          totalGains: Number(payload.totalGains) || 0,
          totalLosses: Number(payload.totalLosses) || 0,
          activeUsers: Number(payload.activeUsers) || 0,
          updatedAt: payload.updatedAt || '',
        });
        setAvailable(true);
        setLoaded(true);
      } catch {
        if (!stopped) setAvailable(false);
      }
    }
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [demo]);

  const signedNet = data.netProfit >= 0 ? `+${money(data.netProfit)}` : `-${money(data.netProfit)}`;

  return (
    <section
      aria-label="Community collective paper trading performance"
      className="rounded-2xl border border-[#D4AF37]/25 bg-[#0d0d0d] overflow-hidden"
      data-testid="collective-pnl-ticker"
    >
      <div className="px-4 py-2.5 border-b border-[#D4AF37]/15 flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
          Community collective P&L
        </span>
        <span className="text-[10px] uppercase tracking-wider text-[#E5C76B]/90">
          Paper trading · Aggregate
        </span>
      </div>
      {demo ? (
        <p className="px-4 py-4 text-sm text-white/60">Community paper results are unavailable in the public demo.</p>
      ) : !available ? (
        <p className="px-4 py-4 text-sm text-white/45">Collective results are temporarily unavailable.</p>
      ) : !loaded ? (
        <p className="px-4 py-4 text-sm text-white/45">Loading community results…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
            <div className="col-span-2 sm:col-span-1">
              <div className="text-[10px] uppercase tracking-wider text-white/40">Net result</div>
              <div className={`mt-1 text-xl font-bold font-mono tabular-nums ${data.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {signedNet}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/40">Total gains</div>
              <div className="mt-1 text-sm font-mono text-emerald-400">{money(data.totalGains)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/40">Total losses</div>
              <div className="mt-1 text-sm font-mono text-red-400">-{money(data.totalLosses)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/40">Active traders</div>
              <div className="mt-1 text-sm font-mono text-white/80">{data.activeUsers}</div>
            </div>
          </div>
          <div className="px-4 py-2 border-t border-white/10 flex items-center justify-between gap-3">
            <span className="text-[10px] text-white/30">All participating users combined; no individual results shown.</span>
            <span className="text-[10px] text-white/30 whitespace-nowrap">
              {data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleTimeString()}` : 'Live'}
            </span>
          </div>
        </>
      )}
      {showCommunityLink && <Link href="/app/community" className="block border-t border-white/10 px-4 py-3 text-sm font-semibold text-amber-300">Open Community →</Link>}
    </section>
  );
}
