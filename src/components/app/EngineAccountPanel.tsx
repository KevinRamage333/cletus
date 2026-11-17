'use client';
import { useCallback, useEffect, useState } from 'react';
import ApprovalQueue from '@/components/ApprovalQueue';
import LivePortfolio, { type PortfolioPosition, type PortfolioTrade } from '@/components/LivePortfolio';
import type { ApprovalRecord } from '@/lib/approvals';
import { Refreshed, StateBox } from '@/components/app/ui';

type Stats = { equity?: number; cash?: number; startingBalance?: number; realizedPnl?: number; unrealized?: number; totalPnl?: number; winRate: number; winRateKnown?: boolean; totalTrades: number; operatorFeeBps?: number; open?: PortfolioPosition[]; closed?: PortfolioTrade[]; approvals?: ApprovalRecord[] };
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Signed-in members' server-side engine paper account. Hidden when there is no account (public preview, signed out). */
export default function EngineAccountPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/protected/stats', { credentials: 'include', cache: 'no-store' });
      if ([401, 403, 404, 503].includes(r.status)) { setHidden(true); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStats(await r.json()); setAt(Date.now()); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'unavailable'); }
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(t); }, [load]);
  if (hidden) return null;
  return (
    <section className="mt-8" data-testid="engine-account">
      <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Engine paper account</h3><Refreshed at={at} stale={!!err} /></div>
      {err && !stats && <StateBox kind="error" title="Engine account could not load">{err}</StateBox>}
      {!stats && !err && <div className="skeleton h-32" />}
      {stats && (
        <div className="tw space-y-4">
          <ApprovalQueue approvals={stats.approvals ?? []} onChange={load} />
          {isNum(stats.equity) && isNum(stats.startingBalance)
            ? <LivePortfolio equity={stats.equity} cash={stats.cash} startingBalance={stats.startingBalance} realizedPnl={stats.realizedPnl ?? 0} unrealizedPnl={stats.unrealized ?? 0} totalPnl={stats.totalPnl ?? 0} winRate={stats.winRateKnown ? stats.winRate / 100 : null} closedTrades={stats.totalTrades} open={stats.open ?? []} closed={stats.closed ?? []} operatorFeeBps={stats.operatorFeeBps} />
            : <StateBox kind="empty" title="No engine account values yet">Start the engine simulator to create one.</StateBox>}
        </div>
      )}
    </section>
  );
}
