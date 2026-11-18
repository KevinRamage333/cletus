'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

type CollectivePnl = {
  netProfit: number | null;
  totalGains: number | null;
  totalLosses: number | null;
  activeUsers: number | null;
  updatedAt: string | null;
  suppressed?: boolean;
};

type Phase = 'loading' | 'error' | 'suppressed' | 'ready' | 'demo';

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
}

function Figure({ value, signed = false }: { value: number | null; signed?: boolean }) {
  if (value === null || Number.isNaN(value)) {
    return <span data-figure="unavailable">Unavailable</span>;
  }
  if (value === 0) {
    return <span data-figure="zero">{signed ? '+$0.00' : '$0.00'}</span>;
  }
  const text = signed ? `${value >= 0 ? '+' : '-'}${money(value)}` : `${value < 0 ? '-' : ''}${money(value)}`;
  return <span data-figure="value">{text}</span>;
}

export default function CollectivePnlTicker({ demo = false, showCommunityLink = false }: { demo?: boolean; showCommunityLink?: boolean }) {
  const [data, setData] = useState<CollectivePnl | null>(null);
  const [phase, setPhase] = useState<Phase>(demo ? 'demo' : 'loading');
  const [stale, setStale] = useState(false);
  // Tracks whether any data has loaded, so the error path never calls setState inside a setData updater.
  const hasData = useRef(false);

  useEffect(() => {
    if (demo) return;
    let stopped = false;
    async function refresh() {
      try {
        const response = await fetch('/api/community/collective-pnl', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error('Collective P&L unavailable');
        const payload = await response.json();
        if (stopped) return;
        const next: CollectivePnl = {
          netProfit: finiteOrNull(payload.netProfit),
          totalGains: finiteOrNull(payload.totalGains),
          totalLosses: finiteOrNull(payload.totalLosses),
          activeUsers: finiteOrNull(payload.activeUsers),
          updatedAt: payload.updatedAt || null,
          suppressed: Boolean(payload.suppressed),
        };
        hasData.current = true;
        setData(next);
        setStale(false);
        setPhase(next.suppressed || next.netProfit === null ? 'suppressed' : 'ready');
      } catch {
        if (!stopped) {
          if (hasData.current) setStale(true);
          else setPhase('error');
        }
      }
    }
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [demo]);

  const ageMs = data?.updatedAt ? Date.now() - new Date(data.updatedAt).getTime() : Number.POSITIVE_INFINITY;
  const view = phase === 'ready' && (stale || ageMs > 60_000) ? 'stale' : phase;
  const refreshed = data?.updatedAt ? `Collective P&L refreshed ${new Date(data.updatedAt).toLocaleTimeString()}` : 'Collective P&L has not refreshed';

  return (
    <section
      aria-label="Community collective paper trading performance"
      className="rounded-2xl border border-[#D4AF37]/25 bg-[#0d0d0d] overflow-hidden"
      data-testid="collective-pnl-ticker"
      data-state={view}
    >
      <div className="px-4 py-2.5 border-b border-[#D4AF37]/15 flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Community collective P&L</span>
        <span className="text-[10px] uppercase tracking-wider text-[#E5C76B]/90">Paper trading · Aggregate</span>
      </div>
      {phase === 'demo' && <p className="px-4 py-4 text-sm text-white/60">Community paper results are unavailable in the public demo.</p>}
      {view === 'loading' && <p className="px-4 py-4 text-sm text-white/45">Loading community results…</p>}
      {view === 'error' && <p className="px-4 py-4 text-sm text-white/45">Collective results are temporarily unavailable.</p>}
      {view === 'stale' && <p className="px-4 py-2 text-xs text-amber-200">Showing the last collective refresh. Newer data is unavailable.</p>}
      {view === 'suppressed' && (
        <p className="px-4 py-4 text-sm text-white/55" data-figure="unavailable">
          Collective P&L is hidden until at least five members opt in. This is not $0.
        </p>
      )}
      {(view === 'ready' || view === 'stale') && data && phase !== 'suppressed' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
          <div className="col-span-2 sm:col-span-1">
            <div className="text-[10px] uppercase tracking-wider text-white/40">Net result</div>
            <div className={`mt-1 text-xl font-bold font-mono tabular-nums ${data.netProfit !== null && data.netProfit < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              <Figure value={data.netProfit} signed />
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">Total gains</div>
            <div className="mt-1 text-sm font-mono text-emerald-400"><Figure value={data.totalGains} /></div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">Total losses</div>
            <div className="mt-1 text-sm font-mono text-red-400"><Figure value={data.totalLosses === null ? null : -Math.abs(data.totalLosses)} /></div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">Active traders</div>
            <div className="mt-1 text-sm font-mono text-white/80">{data.activeUsers === null ? 'Unavailable' : data.activeUsers}</div>
          </div>
        </div>
      )}
      {phase !== 'demo' && (
        <div className="px-4 py-2 border-t border-white/10 flex items-center justify-between gap-3">
          <span className="text-[10px] text-white/30">Opted-in paper accounts only. No individual results.</span>
          <span className="text-[10px] text-white/30 whitespace-nowrap" data-testid="collective-refreshed-at">{refreshed}</span>
        </div>
      )}
      {showCommunityLink && <Link href="/app/community" className="block border-t border-white/10 px-4 py-3 text-sm font-semibold text-amber-300">Open Community →</Link>}
    </section>
  );
}
