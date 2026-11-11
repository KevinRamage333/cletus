'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EMPTY_PUBLIC_LIVE, type PublicLiveStats } from '@/lib/public-live';

const usd = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const cls = (n: number | null | undefined) => (n === null || n === undefined ? 'text-white/70' : n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-white/70');
const ago = (d: string) => {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (!Number.isFinite(s)) return '';
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

export default function PublicLiveFeed({ compact = false }: { compact?: boolean }) {
  const [s, setS] = useState<PublicLiveStats>(EMPTY_PUBLIC_LIVE);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const r = await fetch('/api/live', { cache: 'no-store' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'unavailable');
        if (on) { setS(j); setErr(null); }
      } catch (e) { if (on) setErr((e as Error).message); }
    };
    load();
    const t = setInterval(load, 5000);
    return () => { on = false; clearInterval(t); };
  }, []);

  return (
    <section className="rounded-2xl border border-amber-500/30 bg-[#0b0a07] p-5 space-y-4" data-testid="public-live">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-amber-300">Live recorded book</p>
          <h2 className="text-2xl font-extrabold gold-text m-0">How Cletus is doing</h2>
        </div>
        <div className="flex items-center gap-2">
          {s.hasData && s.allSimulated && <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/50 text-amber-300">SIMULATION</span>}
          {s.hasData && s.anySimulated && !s.allSimulated && <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/50 text-amber-300">MIXED · some simulated</span>}
          {s.hasData && !s.anySimulated && <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-500/50 text-red-300">LIVE RECORDED</span>}
          {compact && <Link href="/live" className="text-sm text-amber-300 no-underline">Full feed</Link>}
        </div>
      </div>

      {!s.hasData ? (
        <p className="text-sm text-zinc-400">No recorded trades yet. This board only shows real closes from Cletus and from users who have traded — it never fills in sample numbers.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Total P&L', usd(s.totalPnlUsd), 'all recorded users, realized'],
              ["Today's P&L", usd(s.todayPnlUsd), 'America/Chicago'],
              ['Win rate', s.winRate == null ? '—' : `${(s.winRate * 100).toFixed(0)}%`, `${s.wins}W / ${s.losses}L`],
              ['Trades', String(s.tradeCount), 'closed sells'],
            ].map(([l, v, sub], i) => (
              <div key={l} className="rounded-xl border border-white/10 bg-black/40 p-3">
                <div className="text-[11px] text-white/40 uppercase tracking-wider">{l}</div>
                <div className={`text-xl font-bold font-mono mt-1 ${i < 2 ? cls(i === 0 ? s.totalPnlUsd : s.todayPnlUsd) : 'text-white'}`}>{v}</div>
                <div className="text-[11px] text-white/40">{sub}</div>
              </div>
            ))}
          </div>
          <ul className="divide-y divide-white/10">
            {(compact ? s.ticker.slice(0, 8) : s.ticker).map((t) => (
              <li key={t.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-[10px] uppercase text-white/40 w-12">{t.side}</span>
                <span className="font-semibold">{t.token}</span>
                <span className="text-[11px] text-white/40">{t.trader}</span>
                {t.simulated && <span className="text-[10px] text-amber-300">sim</span>}
                <span className={`font-mono ml-auto ${cls(t.pnlPct)}`}>{pct(t.pnlPct)}</span>
                <span className="text-[11px] text-white/35">{ago(t.at)}</span>
                {t.solscan && <a href={t.solscan} className="text-amber-300 text-[11px]" target="_blank" rel="noreferrer">Solscan</a>}
              </li>
            ))}
          </ul>
        </>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
      <p className="text-[11px] text-white/45 leading-relaxed">{s.disclaimer} Wallets are hidden unless a trader opts in. House trades show as “Cletus (house)”.</p>
    </section>
  );
}
