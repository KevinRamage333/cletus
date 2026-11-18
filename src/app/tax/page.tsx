'use client';
/**
 * Tax Center: informational tax-responsibility acknowledgment + trade-history CSV export + 30-day trial flag.
 * Collects NO tax IDs, SSNs, or other tax identifiers. Stores only the acknowledgment timestamp.
 * Route: /tax
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ScreenStatus } from '@/components/ScreenStatus';
import { refreshedLabel, screenState } from '@/lib/figure';

type Info = { taxAckAt: string | null; trialActive: boolean; daysRemaining: number; trialDays: number; trialStartedAt: string };

export default function TaxCenterPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [a1, setA1] = useState(false);
  const [a2, setA2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch('/api/protected/tax/ack', { cache: 'no-store' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? 'Tax details are unavailable');
      setInfo(data);
      setError(null);
      setRefreshedAt(new Date().toISOString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tax details are unavailable');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const ack = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/protected/tax/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acknowledgeTaxResponsibility: a1, acknowledgeReporting: a2 }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) setMsg(d.error ?? 'Could not save'); else { setMsg('Acknowledgment recorded.'); load(); }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl space-y-6">
          <div className="flex flex-col items-center">
            <img src="/cletus-logo.png" alt="Cletus" width={80} height={80} className="rounded-full mb-3" />
            <h1 className="text-2xl font-bold tracking-tight gold-text">Tax Center</h1>
            <p className="text-sm text-white/50 mt-1 text-center">Information and your own records. Cletus does not collect tax IDs or SSNs.</p>
          </div>

          <ScreenStatus
            state={screenState({ loading, error, hasData: Boolean(info), empty: Boolean(info) && !info?.taxAckAt, refreshedAt, staleMs: Infinity })}
            error={error}
            emptyLabel="No tax acknowledgment on file yet."
            refreshedLabel={refreshedLabel('Tax view', refreshedAt)}
          />

          <section className={`rounded-xl border p-4 ${info?.trialActive ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/10 bg-white/5'}`}>
            <div className="text-xs font-semibold uppercase tracking-wider text-white/50">30-day trial</div>
            <div className="text-lg font-bold mt-0.5">{info ? (info.trialActive ? <span className="text-emerald-400">{info.daysRemaining} days left</span> : 'Trial period ended') : '…'}</div>
            <p className="text-xs text-white/50 mt-1">{info ? `Started ${new Date(info.trialStartedAt).toLocaleDateString()}. The beta is free; there is no billing.` : ''}</p>
          </section>

          <section className="rounded-xl border border-white/10 bg-[#121212] p-5 space-y-3 text-sm text-white/70 leading-relaxed">
            <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-wide">Your tax responsibility</h2>
            <p>You are solely responsible for determining, reporting, and paying any taxes on your own trading activity in your jurisdiction. Cletus is software; it is not a broker, custodian, or tax advisor and does not file or report taxes for you.</p>
            <p>Beta trades are <strong className="text-white">paper (simulated)</strong> and are not real disposals. If live trading is ever used, every swap of one token for another may be a taxable event. Keep your own records and consult a qualified tax professional.</p>
            <p className="text-xs text-white/40">This page is general information, not tax or legal advice, and needs review by a professional before any production use.</p>
            <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" checked={a1} onChange={(e) => setA1(e.target.checked)} className="mt-1 accent-emerald-500" /><span>I understand I am responsible for my own taxes and that Cletus provides no tax advice.</span></label>
            <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" checked={a2} onChange={(e) => setA2(e.target.checked)} className="mt-1 accent-emerald-500" /><span>I understand I must keep my own records and report any taxable activity myself.</span></label>
            <button onClick={ack} disabled={!a1 || !a2 || busy} className="w-full py-3 rounded-xl text-sm font-semibold bg-emerald-500 text-black disabled:opacity-30">{busy ? 'Saving…' : info?.taxAckAt ? 'Acknowledge again' : 'Acknowledge'}</button>
            {info?.taxAckAt && <p className="text-xs text-emerald-400">Acknowledged {new Date(info.taxAckAt).toLocaleString()}</p>}
            {msg && <p className="text-xs text-white/60">{msg}</p>}
          </section>

          <section className="rounded-xl border border-white/10 bg-[#121212] p-5 space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wide">Trade history export</h2>
            <p className="text-xs text-white/50">CSV of every closed trade on your account: open/close times (UTC), cost basis, proceeds, fees, realized PnL, and transaction signatures for live trades. Paper rows are labeled.</p>
            <a href="/api/protected/tax/export" className="block w-full py-3 rounded-xl text-sm font-semibold text-center border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10">⬇ Download CSV</a>
          </section>

          <div className="text-center"><Link href="/app" className="text-xs text-white/40 hover:text-white">← App home</Link></div>
        </div>
      </main>
    </div>
  );
}
