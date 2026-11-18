'use client';
import { useCallback, useEffect, useState } from 'react';
import LiveWatch from './LiveWatch';
import OwnerPlanCard from './OwnerPlanCard';
import OwnerFundsPanel from './OwnerFundsPanel';
import OwnerKolPanel from './OwnerKolPanel';
import ScanningNowPanel from './ScanningNowPanel';
import type { OwnerStatusPayload } from '@/lib/owner-status';
import OwnersDesk from './OwnersDesk';
import { KOL_TRADING_WALLET } from '@/lib/owner-withdraw-queue';

const usd = (n: number | null | undefined, d = 2) => (n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const tone = (n: number | null | undefined) => (n == null ? 'text-white/70' : n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-white/70');

export default function OwnerDashboard({ onSignOut }: { onSignOut: () => void }) {
  const [data, setData] = useState<OwnerStatusPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSim, setShowSim] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/owner/status', { cache: 'no-store', credentials: 'include' });
      if (r.status === 401 || r.status === 403) { onSignOut(); return; }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'failed');
      setData(j); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, [onSignOut]);

  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);

  async function halt(action: 'halt' | 'resume') {
    const msg = action === 'halt'
      ? 'SELL ALL / HALT: close any open position now and stop all new trades until you resume. This applies to the house trading wallet.'
      : 'Resume trading? New entries will be allowed again (still one at a time, 5/20 exits).';
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/owner/halt', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, confirm: true, reason: action === 'halt' ? 'sell all from /owner' : 'resume from /owner' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'failed');
      await load();
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  }

  if (!data) return <div className="center-page">{err ? <span className="err">{err}</span> : 'Loading the live book…'}</div>;
  const o = data.owner;
  const short = (a: string) => a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
  const hasSim = Boolean(data.simulationWatch && (data.simulationWatch.closedTrades > 0 || data.simulationWatch.feed.length > 0 || data.simulationWatch.open));
  const watch = showSim && data.simulationWatch ? data.simulationWatch : data.watch;
  const kolWatch = data.kolWatch;
  const combined = data.combined;
  const kolWallet = o.kol?.wallet ?? KOL_TRADING_WALLET;
  const mainWatch = showSim
    ? watch
    : { ...watch, label: 'Main wallet · $25k–$5M', walletAddress: watch.walletAddress ?? o.tradingWallet };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <img src="/cletus-logo.png" alt="" className="w-8 h-8 rounded-full" />
        <div>
          <div className="gold-text font-bold text-xl leading-none">The Owner&apos;s Desk</div>
          <div className="text-[11px] text-white/45 font-mono">Main {short(o.tradingWallet)} · KOL {short(kolWallet)} · source {data.source}{data.snapshotAgeMs != null ? ` · snapshot ${Math.round(data.snapshotAgeMs / 1000)}s` : ''}</div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300">OWNER</span>
        <button type="button" className="btn small ml-auto" onClick={async () => { await fetch('/api/owner/logout', { method: 'POST', credentials: 'include' }); onSignOut(); }}>Sign out</button>
      </div>

      <OwnersDesk onAuthLost={onSignOut} />

      {hasSim && (
        <div>
          <button
            type="button"
            className="text-xs px-3 py-1 rounded-full border border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
            data-testid="simulation-history-toggle"
            aria-pressed={showSim}
            onClick={() => setShowSim((v) => !v)}
          >
            {showSim ? 'Back to live book' : 'Simulation history'}
          </button>
        </div>
      )}

      {combined && (
        <section className="rounded-2xl border border-amber-500/30 bg-[#0b0a07] p-4 sm:p-5" data-testid="combined-wallets">
          <div className="text-[11px] uppercase tracking-wider text-amber-300/80">Combined wallets</div>
          <div className="flex flex-wrap items-end justify-between gap-3 mt-1">
            <div>
              <div className="text-4xl sm:text-5xl font-extrabold font-mono leading-tight">{usd(combined.usd)}</div>
              <div className="text-sm text-white/50 font-mono mt-1">{combined.sol != null ? `${combined.sol.toFixed(4)} SOL` : '—'}</div>
            </div>
            <div className="text-xs text-white/55 space-y-0.5 font-mono text-right">
              <div>Main {usd(combined.mainUsd)}{combined.mainSol != null ? ` · ${combined.mainSol.toFixed(4)} SOL` : ''}</div>
              <div>KOL {usd(combined.kolUsd)}{combined.kolSol != null ? ` · ${combined.kolSol.toFixed(4)} SOL` : ''}</div>
              <div>Realized P&amp;L <span className={tone(combined.realizedPnl)}>{usd(combined.realizedPnl)}</span></div>
              <div>{combined.openPositions} open</div>
            </div>
          </div>
        </section>
      )}

      <LiveWatch
        watch={mainWatch}
        actions={{
          sellAllLabel: 'Sell all / halt',
          resumeLabel: 'Resume trading',
          onSellAll: () => halt('halt'),
          onResume: () => halt('resume'),
          busy,
        }}
        footer={
          <div className="rounded-2xl border border-white/10 bg-[#121212] p-4 text-sm text-white/60 space-y-1">
            <div><span className="text-white/40">Book</span> {watch.book === 'simulation' ? 'SIMULATION HISTORY' : 'LIVE'}{watch.book !== 'simulation' ? ' · since 12:23 PM CST Nov 11, 2026' : ''}</div>
            <div><span className="text-white/40">Engine env</span> {o.engine.mode.toUpperCase()}{o.engine.liveBlockedReason ? ` · ${o.engine.liveBlockedReason}` : ''}</div>
            <div><span className="text-white/40">Brain</span> {o.engine.brainProvider ?? '—'}</div>
            <div><span className="text-white/40">Engine</span> {o.engine.lastScanSummary ?? '—'}{o.engine.lastScanAt ? ` · last scan ${new Date(o.engine.lastScanAt).toLocaleTimeString()}` : ''}</div>
            {o.engine.withinSchedule != null && <div><span className="text-white/40">Schedule</span> {o.engine.withinSchedule ? 'in hours' : 'outside hours'}</div>}
          </div>
        }
      />

      {<ScanningNowPanel scan={o.scanning} summary={o.engine.lastScanSummary} lastScanAt={o.engine.lastScanAt} />}

      {kolWatch && (
        <LiveWatch
          watch={kolWatch}
          footer={<OwnerKolPanel kol={o.kol} scanOnly />}
        />
      )}

      {o.plan && <OwnerPlanCard plan={o.plan} />}

      <OwnerFundsPanel />

      <p className="text-[11px] text-white/40">Not financial advice. Past results, including simulated or paper results, do not predict future results. Losses, including total loss of principal, can occur.</p>
    </div>
  );
}
